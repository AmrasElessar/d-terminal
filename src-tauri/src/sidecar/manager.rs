// PTY sidecar process manager.
//
// - Sidecar Node process'i `tauri-plugin-shell` üzerinden spawn edilir
// - Bir writer thread frame'leri stdin'e seri olarak yazar (Mutex<ChildStdin>)
// - Bir reader thread stdout'tan frame decode edip event olarak yayınlar
// - Pane multiplexing: tek sidecar 50 pane'e kadar (ADR-0001)
// - Heartbeat: PING gönderir, PONG ile sidecar'ın ayakta olduğunu doğrular

use crate::error::{AppError, AppResult};
use crate::sidecar::protocol::{
    decode_cbor, encode_cbor, ExitPayload, Frame, MsgType, ResizePayload, SpawnPayload,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const MAX_PANES_PER_SIDECAR: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PtyEvent {
    Stdout {
        pane_id: String,
        data: Vec<u8>,
    },
    Exit {
        pane_id: String,
        exit_code: i32,
        signal: Option<String>,
    },
    Error {
        pane_id: Option<String>,
        code: String,
        message: String,
    },
    SidecarDown {
        reason: String,
    },
    SidecarUp,
}

pub struct SidecarManager {
    inner: Mutex<Inner>,
    /// Dış dünya bu Receiver'ı consume edip Tauri event olarak emit eder.
    /// `take_events()` ile bir kez alınır (lib.rs setup).
    events_rx: Mutex<Option<Receiver<PtyEvent>>>,
    events_tx: SyncSender<PtyEvent>,
    sidecar_path: std::path::PathBuf,
}

struct Inner {
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    panes: HashSet<u64>,
    next_pane_id: u64,
    last_pong: Instant,
}

/// PTY event kuyruğu için backpressure sınırı.
///
/// Daha önce `std::sync::mpsc::channel()` (unbounded) kullanılıyordu — frontend
/// yavaşlarsa (V8 GC pause, WebView IPC bloklama) PTY çıktısı sınırsız büyür
/// ve OOM riski doğardı (`cat huge.log` gibi senaryolarda 100 MB/sn enqueue).
/// `sync_channel(N)` ile sıkışınca sender bloklanır ya da `try_send` Drop yolu
/// devreye girer; reader thread doğal olarak yavaşlar (TCP backpressure'a
/// benzer). 4096 yeterince büyük (lifecycle event'leri yutulmaz) ama kayda
/// değer bir bellek üst sınırı koyar (~64 KB sentinel ortalama × 4096 ≈ 256 MB
/// worst-case, pratikte coalescing ile çok altında).
const EVENT_QUEUE_CAPACITY: usize = 4096;

impl SidecarManager {
    pub fn new(sidecar_path: std::path::PathBuf) -> Arc<Self> {
        let (tx, rx) = sync_channel(EVENT_QUEUE_CAPACITY);
        Arc::new(Self {
            inner: Mutex::new(Inner {
                child: None,
                stdin: None,
                panes: HashSet::new(),
                next_pane_id: 1,
                last_pong: Instant::now(),
            }),
            events_rx: Mutex::new(Some(rx)),
            events_tx: tx,
            sidecar_path,
        })
    }

    pub fn take_event_receiver(&self) -> Option<Receiver<PtyEvent>> {
        self.events_rx.lock().take()
    }

    /// Sidecar process'i başlatır (idempotent — hâlihazırda canlıysa no-op).
    pub fn ensure_started(self: &Arc<Self>) -> AppResult<()> {
        let mut inner = self.inner.lock();
        if inner.child.is_some() {
            return Ok(());
        }
        // Geliştirme modunda `node sidecar/pty-bridge.js`, prod'da bundled binary
        let mut cmd = if self.sidecar_path.extension().and_then(|s| s.to_str()) == Some("js") {
            let mut c = Command::new("node");
            c.arg(&self.sidecar_path);
            c
        } else {
            Command::new(&self.sidecar_path)
        };
        // Windows: pkg-bundled sidecar default console subsystem ile derlenir;
        // CREATE_NO_WINDOW olmadan Windows ona ayrı bir console penceresi açar.
        // Kullanıcı o pencereyi kapatınca sidecar ölür → "stdout closed".
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Sidecar(format!("spawn failed: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Sidecar("stdin pipe missing".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Sidecar("stdout pipe missing".into()))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Sidecar("stderr pipe missing".into()))?;

        let stdin_arc = Arc::new(Mutex::new(stdin));
        inner.stdin = Some(stdin_arc.clone());
        inner.child = Some(child);
        inner.last_pong = Instant::now();

        spawn_reader_thread(stdout, self.events_tx.clone(), Arc::downgrade(self));
        spawn_stderr_thread(stderr);
        spawn_heartbeat_thread(stdin_arc, Arc::downgrade(self));

        try_send_lifecycle(&self.events_tx, PtyEvent::SidecarUp);
        tracing::info!("sidecar process started");
        Ok(())
    }

    fn write_frame(&self, frame: &Frame) -> AppResult<()> {
        let inner = self.inner.lock();
        let stdin = inner
            .stdin
            .as_ref()
            .ok_or_else(|| AppError::Sidecar("sidecar not started".into()))?
            .clone();
        drop(inner);
        let bytes = frame.to_bytes()?;
        let mut guard = stdin.lock();
        guard
            .write_all(&bytes)
            .map_err(|e| AppError::Sidecar(format!("stdin write: {e}")))?;
        guard
            .flush()
            .map_err(|e| AppError::Sidecar(format!("stdin flush: {e}")))?;
        Ok(())
    }

    pub fn spawn_pane(self: &Arc<Self>, payload: SpawnPayload) -> AppResult<u64> {
        self.ensure_started()?;
        let pane_id = {
            let mut inner = self.inner.lock();
            if inner.panes.len() >= MAX_PANES_PER_SIDECAR {
                return Err(AppError::Sidecar(format!(
                    "pane limit reached ({MAX_PANES_PER_SIDECAR})"
                )));
            }
            let id = inner.next_pane_id;
            inner.next_pane_id += 1;
            inner.panes.insert(id);
            id
        };
        let shell_for_log = payload.shell.clone();
        let cbor = encode_cbor(&payload)?;
        tracing::info!(
            pane_id,
            shell = %shell_for_log,
            "→ SPAWN frame to sidecar"
        );
        self.write_frame(&Frame::new(MsgType::Spawn, pane_id, cbor))?;
        Ok(pane_id)
    }

    pub fn write_stdin(&self, pane_id: u64, data: &[u8]) -> AppResult<()> {
        let inner = self.inner.lock();
        if !inner.panes.contains(&pane_id) {
            return Err(AppError::PaneNotFound(pane_id.to_string()));
        }
        drop(inner);
        tracing::trace!(pane_id, bytes = data.len(), "→ STDIN");
        self.write_frame(&Frame::new(MsgType::Stdin, pane_id, data.to_vec()))
    }

    pub fn resize(&self, pane_id: u64, cols: u16, rows: u16) -> AppResult<()> {
        let cbor = encode_cbor(&ResizePayload { cols, rows })?;
        self.write_frame(&Frame::new(MsgType::Resize, pane_id, cbor))
    }

    pub fn kill(&self, pane_id: u64) -> AppResult<()> {
        {
            let mut inner = self.inner.lock();
            inner.panes.remove(&pane_id);
        }
        self.write_frame(&Frame::new(MsgType::Kill, pane_id, Vec::new()))
    }

    pub fn shutdown(&self) {
        let mut inner = self.inner.lock();
        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            // Sidecar'ın temiz kapanması için kısa bir wait — child.kill()
            // SIGKILL eşdeğeri Windows TerminateProcess; sidecar tarafındaki
            // pty cleanup için 100ms tolerance ver. Tauri exit'inde bu yeterli.
            let _ = child.wait();
        }
        inner.stdin = None;
        inner.panes.clear();
    }
}

/// Sidecar process'i Tauri kapanırken / SidecarManager Arc'ı drop edilirken
/// otomatik olarak temizle. Bu olmadan child handle drop edildiğinde Windows
/// `dterminal-pty-bridge.exe` process'i orphan kalabilir (15s heartbeat
/// timeout'a kadar). Drop impl + Tauri RunEvent::ExitRequested handler
/// kombinasyonu zombi sidecar riskini kapatır.
impl Drop for SidecarManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Lifecycle event'leri (SidecarUp/Down/Error/Exit) için non-blocking send.
/// Kuyruk doluysa drop edilir + warn loglanır — heartbeat veya error
/// path'lerinde block etmek deadlock yaratabilir.
fn try_send_lifecycle(tx: &SyncSender<PtyEvent>, ev: PtyEvent) {
    match tx.try_send(ev) {
        Ok(_) => {}
        Err(TrySendError::Full(dropped)) => {
            tracing::warn!(?dropped, "PTY event queue full, dropped lifecycle event");
        }
        Err(TrySendError::Disconnected(_)) => {
            // Receiver dropped — uygulama kapanıyor, sessiz geç.
        }
    }
}

fn spawn_reader_thread(
    stdout: ChildStdout,
    tx: SyncSender<PtyEvent>,
    weak: std::sync::Weak<SidecarManager>,
) {
    let tx_for_err = tx.clone();
    let result = thread::Builder::new()
        .name("dterm-sidecar-reader".into())
        .spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match Frame::decode(&mut reader) {
                    Ok(Some(frame)) => {
                        if let Some(mgr) = weak.upgrade() {
                            handle_inbound(&mgr, &tx, frame);
                        } else {
                            break;
                        }
                    }
                    Ok(None) => {
                        try_send_lifecycle(
                            &tx,
                            PtyEvent::SidecarDown {
                                reason: "stdout closed".into(),
                            },
                        );
                        break;
                    }
                    Err(e) => {
                        try_send_lifecycle(
                            &tx,
                            PtyEvent::SidecarDown {
                                reason: format!("decode error: {e}"),
                            },
                        );
                        break;
                    }
                }
            }
        });
    if let Err(e) = result {
        tracing::error!(error = %e, "failed to spawn sidecar reader thread");
        try_send_lifecycle(
            &tx_for_err,
            PtyEvent::SidecarDown {
                reason: format!("reader thread spawn failed: {e}"),
            },
        );
    }
}

fn handle_inbound(mgr: &Arc<SidecarManager>, tx: &SyncSender<PtyEvent>, frame: Frame) {
    tracing::trace!(
        msg_type = ?frame.msg_type,
        pane_id = frame.pane_id,
        payload_len = frame.payload.len(),
        "← from sidecar"
    );
    match frame.msg_type {
        MsgType::Stdout => {
            // Stdout için BLOCKING send — backpressure: kuyruk doluysa reader
            // thread bloklanır → sidecar stdout pipe dolar → sidecar Node
            // process'inde proc.write doğal yavaşlar → PTY shell'i yavaşlatır.
            // Bu zincir OOM riskini ortadan kaldırır; kullanıcı UI'da kısa
            // gecikme görür ama hiçbir output kaybetmez.
            let _ = tx.send(PtyEvent::Stdout {
                pane_id: frame.pane_id.to_string(),
                data: frame.payload,
            });
        }
        MsgType::Exit => {
            let payload: Result<ExitPayload, _> = decode_cbor(&frame.payload);
            let (code, signal) = payload
                .map(|p| (p.exit_code, p.signal))
                .unwrap_or((-1, None));
            mgr.inner.lock().panes.remove(&frame.pane_id);
            try_send_lifecycle(
                tx,
                PtyEvent::Exit {
                    pane_id: frame.pane_id.to_string(),
                    exit_code: code,
                    signal,
                },
            );
        }
        MsgType::Error => {
            let parsed: Result<crate::sidecar::protocol::ErrorPayload, _> =
                decode_cbor(&frame.payload);
            let (code, message) = parsed
                .map(|p| (p.code, p.message))
                .unwrap_or_else(|e| ("unknown".into(), e.to_string()));
            let pane = if frame.pane_id == 0 {
                None
            } else {
                Some(frame.pane_id.to_string())
            };
            try_send_lifecycle(
                tx,
                PtyEvent::Error {
                    pane_id: pane,
                    code,
                    message,
                },
            );
        }
        MsgType::Pong => {
            mgr.inner.lock().last_pong = Instant::now();
        }
        // Ping yöneticiden gelmez; gelse bile bilgi notu yeter
        MsgType::Ping => {}
        // Sidecar→Tauri yönünde anlam taşımayan tipler
        _ => {}
    }
}

fn spawn_stderr_thread(stderr: std::process::ChildStderr) {
    let result = thread::Builder::new()
        .name("dterm-sidecar-stderr".into())
        .spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let line = String::from_utf8_lossy(&buf[..n]);
                        for l in line.lines() {
                            tracing::info!(target: "sidecar", "{l}");
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    // Stderr thread başlatılamazsa tek sonuç sidecar log mesajlarını
    // göremeyiz — kritik değil, app çalışmaya devam eder.
    if let Err(e) = result {
        tracing::warn!(error = %e, "failed to spawn sidecar stderr thread (logs will be lost)");
    }
}

fn spawn_heartbeat_thread(stdin: Arc<Mutex<ChildStdin>>, weak: std::sync::Weak<SidecarManager>) {
    let weak_for_err = weak.clone();
    let result = thread::Builder::new()
        .name("dterm-sidecar-heartbeat".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(5));
            let Some(mgr) = weak.upgrade() else { break };
            // PONG son 15 saniyede gelmediyse sidecar dead say
            let last = mgr.inner.lock().last_pong;
            if last.elapsed() > Duration::from_secs(15) {
                try_send_lifecycle(
                    &mgr.events_tx,
                    PtyEvent::SidecarDown {
                        reason: "heartbeat timeout".into(),
                    },
                );
                mgr.shutdown();
                break;
            }
            let frame = Frame::control(MsgType::Ping);
            let bytes = match frame.to_bytes() {
                Ok(b) => b,
                Err(_) => continue,
            };
            let mut guard = stdin.lock();
            if guard.write_all(&bytes).is_err() {
                break;
            }
            let _ = guard.flush();
        });
    if let Err(e) = result {
        tracing::error!(error = %e, "failed to spawn sidecar heartbeat thread");
        if let Some(mgr) = weak_for_err.upgrade() {
            try_send_lifecycle(
                &mgr.events_tx,
                PtyEvent::SidecarDown {
                    reason: format!("heartbeat thread spawn failed: {e}"),
                },
            );
        }
    }
}
