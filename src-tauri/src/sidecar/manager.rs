// PTY sidecar process manager.
//
// - Sidecar process'i `std::process::Command` ile spawn edilir (shell yok)
// - Tek bir writer thread tüm giden frame'leri (SPAWN/STDIN/RESIZE/KILL/PING/
//   FLOW_RESUME) sırayla sidecar stdin'ine yazar. Tauri command'ları yalnızca
//   kuyruğa ekler → UI thread'i pipe yazımında asla bloklanmaz ve frame sırası
//   (ör. SPAWN → STDIN) korunur.
// - Bir reader thread stdout'tan frame decode edip event olarak yayınlar
// - Pane multiplexing: tek sidecar 50 pane'e kadar (ADR-0001)
// - Heartbeat: PING gönderir, PONG ile sidecar'ın ayakta olduğunu doğrular
// - Her sidecar başlatması bir "generation" alır. Reader EOF'u, yazma hatası,
//   protokol uyumsuzluğu gibi olaylar yalnızca kendi generation'ını
//   temizler (`teardown`) → eski sidecar'ın geç gelen olayları yeni
//   sidecar'ı bozamaz.

use crate::error::{AppError, AppResult};
use crate::process_jail::ProcessJail;
use crate::sidecar::protocol::{
    decode_cbor, encode_cbor, ExitPayload, FlowPayload, Frame, MsgType, ResizePayload,
    SpawnPayload, MAX_PAYLOAD,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Weak};
use std::thread;
use std::time::{Duration, Instant};

const MAX_PANES_PER_SIDECAR: usize = 50;

/// STDIN frame başına maksimum payload. Büyük paste'ler bu boyutta parçalanır
/// (MAX_PAYLOAD'ı aşan tek frame sidecar'ı öldürürdü).
const STDIN_CHUNK: usize = 1024 * 1024;

/// Writer kuyruğunda bekleyebilecek toplam payload üst sınırı. Aşılırsa
/// `pty_write` hata döner (sınırsız bellek büyümesini önler).
const MAX_QUEUED_BYTES: usize = 64 * 1024 * 1024;

/// Sidecar'ın HELLO'da ilan ettiği credit tabanlı akış kontrolü yeteneği.
const CAP_FLOW_CREDIT: &str = "flow_credit";

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);

/// PTY stdout byte'ları frontend'e standart base64 (padding'li) string olarak
/// gider. JSON sayı dizisine göre ~3-4x daha küçük ve WebView tarafında
/// tek bir string decode'u yeterli.
mod b64 {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(data: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(data))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD.decode(s).map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PtyEvent {
    Stdout {
        pane_id: String,
        #[serde(with = "b64")]
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

/// Writer kuyruğundaki tek iş: hangi sidecar generation'ı için yazıldığı +
/// frame'in kendisi. Generation değişmişse (sidecar yeniden başladı) frame
/// atılır — eski pane'lere ait STDIN yeni sidecar'a gitmez.
struct Outgoing {
    gen: u64,
    frame: Frame,
}

pub struct SidecarManager {
    inner: Mutex<Inner>,
    /// Dış dünya bu Receiver'ı consume edip Tauri event olarak emit eder.
    /// `take_events()` ile bir kez alınır (lib.rs setup).
    events_rx: Mutex<Option<Receiver<PtyEvent>>>,
    events_tx: SyncSender<PtyEvent>,
    sidecar_path: std::path::PathBuf,
    /// Spawn edilen sidecar process'i bu Job Object jail'ine atanır.
    jail: Arc<ProcessJail>,
    /// Writer thread kuyruğu. Manager drop edilince Sender düşer ve writer
    /// thread kendiliğinden çıkar.
    out_tx: Mutex<Option<Sender<Outgoing>>>,
    queued_bytes: Arc<AtomicUsize>,
}

struct Inner {
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    /// Sidecar şu an çalışıyor mu (teardown'da false).
    running: bool,
    /// Her başlatmada artar; reader/writer/heartbeat kendi generation'larını
    /// taşır.
    generation: u64,
    /// Aktif generation'ın heartbeat durdurma bayrağı.
    stop: Arc<AtomicBool>,
    /// Sidecar credit modunu destekliyor ve etkinleştirildi.
    flow_credit: bool,
    panes: HashSet<u64>,
    next_pane_id: u64,
    last_pong: Instant,
    /// Reader/stderr/heartbeat thread join handle'ları. Restart ve
    /// shutdown'da join edilir (çağıran thread'in kendisi hariç).
    threads: Vec<thread::JoinHandle<()>>,
}

/// PTY event kuyruğu için backpressure sınırı.
///
/// `sync_channel(N)` ile sıkışınca stdout send'i bloklanır; reader thread
/// doğal olarak yavaşlar. Asıl adalet (bir pane'in diğerlerini boğmaması)
/// sidecar tarafındaki credit tabanlı akış kontrolüyle sağlanır: her pane en
/// fazla ~1 MB onaylanmamış çıktı biriktirebilir (bkz. `ack_output`).
const EVENT_QUEUE_CAPACITY: usize = 16384;

impl SidecarManager {
    pub fn new(sidecar_path: std::path::PathBuf, jail: Arc<ProcessJail>) -> Arc<Self> {
        let (tx, rx) = sync_channel(EVENT_QUEUE_CAPACITY);
        let (out_tx, out_rx) = channel::<Outgoing>();
        let queued_bytes = Arc::new(AtomicUsize::new(0));
        let mgr = Arc::new(Self {
            inner: Mutex::new(Inner {
                child: None,
                stdin: None,
                running: false,
                generation: 0,
                stop: Arc::new(AtomicBool::new(true)),
                flow_credit: false,
                panes: HashSet::new(),
                next_pane_id: 1,
                last_pong: Instant::now(),
                threads: Vec::new(),
            }),
            events_rx: Mutex::new(Some(rx)),
            events_tx: tx,
            sidecar_path,
            jail,
            out_tx: Mutex::new(Some(out_tx)),
            queued_bytes: queued_bytes.clone(),
        });
        if let Err(e) = spawn_writer_thread(out_rx, Arc::downgrade(&mgr), queued_bytes) {
            tracing::error!(error = %e, "failed to spawn sidecar writer thread");
            *mgr.out_tx.lock() = None;
        }
        mgr
    }

    pub fn take_event_receiver(&self) -> Option<Receiver<PtyEvent>> {
        self.events_rx.lock().take()
    }

    /// Takip edilen (canlı kabul edilen) pane sayısı — diagnostic/test.
    pub fn pane_count(&self) -> usize {
        self.inner.lock().panes.len()
    }

    /// Sidecar process'i başlatır (idempotent — canlıysa no-op). Aktif
    /// generation'ı döndürür.
    pub fn ensure_started(self: &Arc<Self>) -> AppResult<u64> {
        // Çalışıyor görünen ama process'i ölmüş sidecar → önce temizle.
        let dead_gen = {
            let mut inner = self.inner.lock();
            if inner.running {
                let exited = match inner.child.as_mut() {
                    Some(child) => !matches!(child.try_wait(), Ok(None)),
                    None => true,
                };
                if !exited {
                    return Ok(inner.generation);
                }
                Some(inner.generation)
            } else {
                None
            }
        };
        if let Some(gen) = dead_gen {
            self.teardown(gen, "sidecar process exited");
        }

        let mut inner = self.inner.lock();
        if inner.running {
            // Başka bir thread araya girip başlatmış.
            return Ok(inner.generation);
        }

        let mut cmd = self.build_command();
        // ProcessJail uygula: CREATE_NO_WINDOW + (Windows) Job Object membership.
        self.jail.configure_command(&mut cmd);
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| AppError::Sidecar(format!("spawn failed: {e}")))?;
        // Job'a assign — D-Terminal crash'inde sidecar otomatik temizlenir.
        match self.jail.assign(&child) {
            Ok(true) => tracing::debug!("sidecar assigned to job"),
            Ok(false) => tracing::debug!("sidecar spawn: job not configured (suppress off?)"),
            Err(e) => {
                // Settings → Privacy ekranı bu flag'i okuyup kullanıcıya
                // "kill-on-close garantisi kayboldu" uyarısı gösterir.
                self.jail.mark_assign_failed();
                tracing::warn!(error = %e, "sidecar job assign failed; kill-on-close skipped")
            }
        }

        let pipes = (child.stdin.take(), child.stdout.take(), child.stderr.take());
        let (Some(stdin), Some(stdout), Some(stderr)) = pipes else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Sidecar("sidecar pipes missing".into()));
        };

        inner.generation += 1;
        let gen = inner.generation;
        let stop = Arc::new(AtomicBool::new(false));
        inner.stop = stop.clone();
        inner.stdin = Some(Arc::new(Mutex::new(stdin)));
        inner.child = Some(child);
        inner.running = true;
        inner.flow_credit = false;
        inner.last_pong = Instant::now();
        let old_threads = std::mem::take(&mut inner.threads);
        // Lock'u bırak — join blocking olabilir ve reader thread'ler
        // `handle_inbound` içinde inner lock'unu alır.
        drop(inner);

        // Eski generation thread'leri: teardown child'ı öldürdü (pipe'lar EOF)
        // ve stop bayrağını set etti; heartbeat park'tan uyandırılır.
        join_threads(old_threads);

        let mut new_threads: Vec<thread::JoinHandle<()>> = Vec::with_capacity(3);
        if let Some(h) =
            spawn_reader_thread(stdout, self.events_tx.clone(), Arc::downgrade(self), gen)
        {
            new_threads.push(h);
        }
        if let Some(h) = spawn_stderr_thread(stderr) {
            new_threads.push(h);
        }
        if let Some(h) = spawn_heartbeat_thread(Arc::downgrade(self), gen, stop) {
            new_threads.push(h);
        }
        self.inner.lock().threads.extend(new_threads);

        try_send_lifecycle(&self.events_tx, PtyEvent::SidecarUp);
        tracing::info!(generation = gen, "sidecar process started");
        Ok(gen)
    }

    fn build_command(&self) -> Command {
        // Geliştirme modunda `node sidecar/pty-bridge.js`, prod'da bundled
        // binary. `.js` yolu yalnızca debug build'de kabul edilir — release'de
        // PATH'teki `node` ile çalışma dizininden script çalıştırmak kod
        // enjeksiyonu yüzeyi olurdu.
        #[cfg(debug_assertions)]
        if self.sidecar_path.extension().and_then(|s| s.to_str()) == Some("js") {
            let mut c = Command::new("node");
            c.arg(&self.sidecar_path);
            return c;
        }
        Command::new(&self.sidecar_path)
    }

    /// Bir generation'ı kalıcı olarak kapatır: child'ı öldürür, pane'leri
    /// boşaltır ve her yetim pane için `Exit` + bir `SidecarDown` emit eder.
    /// Thread join ETMEZ (reader/writer thread'lerinden güvenle çağrılabilir);
    /// join bir sonraki `ensure_started` veya `shutdown`'da yapılır.
    /// Generation eşleşmiyorsa (zaten temizlenmiş / yeni sidecar çalışıyor)
    /// no-op.
    fn teardown(&self, gen: u64, reason: &str) {
        let (child, orphans, threads_to_wake) = {
            let mut inner = self.inner.lock();
            if inner.generation != gen || !inner.running {
                return;
            }
            inner.running = false;
            inner.flow_credit = false;
            inner.stop.store(true, Ordering::SeqCst);
            inner.stdin = None;
            let child = inner.child.take();
            let mut orphans: Vec<u64> = inner.panes.drain().collect();
            orphans.sort_unstable();
            let wake: Vec<thread::Thread> =
                inner.threads.iter().map(|h| h.thread().clone()).collect();
            (child, orphans, wake)
        };
        for t in threads_to_wake {
            t.unpark();
        }
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
        tracing::warn!(generation = gen, orphans = orphans.len(), %reason, "sidecar torn down");
        for pane in orphans {
            try_send_lifecycle(
                &self.events_tx,
                PtyEvent::Exit {
                    pane_id: pane.to_string(),
                    exit_code: -1,
                    signal: Some("sidecar_lost".into()),
                },
            );
        }
        try_send_lifecycle(
            &self.events_tx,
            PtyEvent::SidecarDown {
                reason: reason.to_string(),
            },
        );
    }

    /// Frame'i writer kuyruğuna ekler (non-blocking).
    fn enqueue(&self, gen: u64, frame: Frame) -> AppResult<()> {
        if frame.payload.len() > MAX_PAYLOAD {
            return Err(AppError::InvalidArg(format!(
                "payload too large: {} bytes (max {MAX_PAYLOAD})",
                frame.payload.len()
            )));
        }
        let n = frame.payload.len();
        let guard = self.out_tx.lock();
        let tx = guard
            .as_ref()
            .ok_or_else(|| AppError::Sidecar("sidecar writer unavailable".into()))?;
        self.queued_bytes.fetch_add(n, Ordering::SeqCst);
        if tx.send(Outgoing { gen, frame }).is_err() {
            self.queued_bytes.fetch_sub(n, Ordering::SeqCst);
            return Err(AppError::Sidecar("sidecar writer stopped".into()));
        }
        Ok(())
    }

    /// Aktif generation (çalışıyorsa).
    fn live_generation(&self) -> Option<u64> {
        let inner = self.inner.lock();
        inner.running.then_some(inner.generation)
    }

    pub fn spawn_pane(self: &Arc<Self>, payload: SpawnPayload) -> AppResult<u64> {
        let gen = self.ensure_started()?;
        let cbor = encode_cbor(&payload)?;
        let pane_id = {
            let mut inner = self.inner.lock();
            if !inner.running || inner.generation != gen {
                return Err(AppError::Sidecar("sidecar restarted during spawn".into()));
            }
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
        tracing::info!(pane_id, shell = %payload.shell, "→ SPAWN frame to sidecar");
        if let Err(e) = self.enqueue(gen, Frame::new(MsgType::Spawn, pane_id, cbor)) {
            // Slot sızdırma: SPAWN hiç gönderilemediyse pane'i geri al.
            self.inner.lock().panes.remove(&pane_id);
            return Err(e);
        }
        Ok(pane_id)
    }

    pub fn write_stdin(&self, pane_id: u64, data: &[u8]) -> AppResult<()> {
        let gen = {
            let inner = self.inner.lock();
            if !inner.running || !inner.panes.contains(&pane_id) {
                return Err(AppError::PaneNotFound(pane_id.to_string()));
            }
            inner.generation
        };
        if self.queued_bytes.load(Ordering::SeqCst) + data.len() > MAX_QUEUED_BYTES {
            return Err(AppError::Sidecar("pty write queue full".into()));
        }
        tracing::trace!(pane_id, bytes = data.len(), "→ STDIN");
        for chunk in data.chunks(STDIN_CHUNK) {
            self.enqueue(gen, Frame::new(MsgType::Stdin, pane_id, chunk.to_vec()))?;
        }
        Ok(())
    }

    pub fn resize(&self, pane_id: u64, cols: u16, rows: u16) -> AppResult<()> {
        let Some(gen) = self.live_generation() else {
            return Ok(());
        };
        let cbor = encode_cbor(&ResizePayload { cols, rows })?;
        self.enqueue(gen, Frame::new(MsgType::Resize, pane_id, cbor))
    }

    pub fn kill(&self, pane_id: u64) -> AppResult<()> {
        // Pane'i HEMEN panes set'inden silmiyoruz — sidecar PTY'yi
        // sonlandırınca EXIT frame gönderir, handle_inbound EXIT'te
        // panes.remove yapar — frontend'e EXIT garanti edilir. Sidecar yoksa
        // teardown zaten Exit emit etmiştir.
        let Some(gen) = self.live_generation() else {
            return Ok(());
        };
        self.enqueue(gen, Frame::new(MsgType::Kill, pane_id, Vec::new()))
    }

    /// Emit thread'i `bytes` kadar stdout'u frontend'e ilettikten sonra
    /// çağırır; sidecar bu pane için credit'i geri kazanır (FLOW_RESUME).
    pub fn ack_output(&self, pane_id: &str, bytes: usize) {
        let Ok(id) = pane_id.parse::<u64>() else {
            return;
        };
        let gen = {
            let inner = self.inner.lock();
            if !inner.running || !inner.flow_credit || !inner.panes.contains(&id) {
                return;
            }
            inner.generation
        };
        if let Ok(cbor) = encode_cbor(&FlowPayload {
            bytes: bytes as u64,
        }) {
            let _ = self.enqueue(gen, Frame::new(MsgType::FlowResume, id, cbor));
        }
    }

    pub fn shutdown(&self) {
        let (child, threads) = {
            let mut inner = self.inner.lock();
            inner.running = false;
            inner.flow_credit = false;
            inner.stop.store(true, Ordering::SeqCst);
            inner.stdin = None;
            inner.panes.clear();
            (inner.child.take(), std::mem::take(&mut inner.threads))
        };
        for h in &threads {
            h.thread().unpark();
        }
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
        join_threads(threads);
    }
}

/// Thread'leri join eder; çağıran thread'in kendisini (ör. reader thread
/// üzerinde son Arc düşüp Drop → shutdown çalıştıysa) join etmeye çalışmaz —
/// self-join Windows'ta sonsuz bekleme, POSIX'te EDEADLK panic'i olurdu.
fn join_threads(threads: Vec<thread::JoinHandle<()>>) {
    let me = thread::current().id();
    for h in threads {
        if h.thread().id() == me {
            continue; // detach
        }
        h.thread().unpark();
        let _ = h.join();
    }
}

/// Sidecar process'i Tauri kapanırken / SidecarManager Arc'ı drop edilirken
/// otomatik olarak temizle.
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

fn spawn_writer_thread(
    rx: Receiver<Outgoing>,
    weak: Weak<SidecarManager>,
    queued_bytes: Arc<AtomicUsize>,
) -> std::io::Result<thread::JoinHandle<()>> {
    thread::Builder::new()
        .name("dterm-sidecar-writer".into())
        .spawn(move || {
            while let Ok(out) = rx.recv() {
                let n = out.frame.payload.len();
                let Some(mgr) = weak.upgrade() else {
                    queued_bytes.fetch_sub(n, Ordering::SeqCst);
                    break;
                };
                let stdin = {
                    let inner = mgr.inner.lock();
                    if inner.running && inner.generation == out.gen {
                        inner.stdin.clone()
                    } else {
                        None
                    }
                };
                if let Some(stdin) = stdin {
                    let result = {
                        let mut guard = stdin.lock();
                        out.frame
                            .encode(&mut *guard)
                            .map_err(|e| e.to_string())
                            .and_then(|_| guard.flush().map_err(|e| e.to_string()))
                    };
                    if let Err(e) = result {
                        tracing::warn!(error = %e, "sidecar stdin write failed");
                        // Gerçek I/O hatası → sidecar'ı öldür + pane'leri
                        // temizle; sonraki spawn yeni sidecar başlatır.
                        mgr.teardown(out.gen, "stdin write failed");
                    }
                }
                queued_bytes.fetch_sub(n, Ordering::SeqCst);
            }
        })
}

fn spawn_reader_thread(
    stdout: ChildStdout,
    tx: SyncSender<PtyEvent>,
    weak: Weak<SidecarManager>,
    gen: u64,
) -> Option<thread::JoinHandle<()>> {
    let tx_for_err = tx.clone();
    let weak_for_err = weak.clone();
    let result = thread::Builder::new()
        .name("dterm-sidecar-reader".into())
        .spawn(move || {
            // 64 KB buffer — PTY frame'leri 4-256 KB tipik.
            let mut reader = BufReader::with_capacity(64 * 1024, stdout);
            let reason = loop {
                match crate::sidecar::protocol::Frame::decode(&mut reader) {
                    Ok(Some(frame)) => {
                        let Some(mgr) = weak.upgrade() else {
                            return;
                        };
                        if !handle_inbound(&mgr, &tx, gen, frame) {
                            break "protocol version mismatch".to_string();
                        }
                    }
                    Ok(None) => break "stdout closed".to_string(),
                    Err(e) => break format!("decode error: {e}"),
                }
            };
            if let Some(mgr) = weak.upgrade() {
                mgr.teardown(gen, &reason);
            }
        });
    match result {
        Ok(handle) => Some(handle),
        Err(e) => {
            tracing::error!(error = %e, "failed to spawn sidecar reader thread");
            if let Some(mgr) = weak_for_err.upgrade() {
                mgr.teardown(gen, &format!("reader thread spawn failed: {e}"));
            } else {
                try_send_lifecycle(
                    &tx_for_err,
                    PtyEvent::SidecarDown {
                        reason: format!("reader thread spawn failed: {e}"),
                    },
                );
            }
            None
        }
    }
}

/// Gelen frame'i işler. `false` dönerse bağlantı kapatılmalıdır (uyumsuz
/// protokol) — reader thread döngüden çıkıp kendi generation'ını temizler.
fn handle_inbound(
    mgr: &Arc<SidecarManager>,
    tx: &SyncSender<PtyEvent>,
    gen: u64,
    frame: Frame,
) -> bool {
    tracing::trace!(
        msg_type = ?frame.msg_type,
        pane_id = frame.pane_id,
        payload_len = frame.payload.len(),
        "← from sidecar"
    );
    match frame.msg_type {
        MsgType::Stdout => {
            // Stdout için BLOCKING send — kuyruk doluysa reader thread
            // bloklanır, hiçbir çıktı kaybolmaz. Pane başına birikim sidecar
            // credit kontrolüyle sınırlıdır.
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
            if frame.pane_id != 0 && code == "spawn_failed" {
                // Sidecar ayrıca EXIT gönderir; yine de slot'u burada da
                // serbest bırak (EXIT kaybolsa bile limit sızmasın).
                mgr.inner.lock().panes.remove(&frame.pane_id);
            }
            let pane = (frame.pane_id != 0).then(|| frame.pane_id.to_string());
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
        MsgType::Ping => {
            mgr.inner.lock().last_pong = Instant::now();
            let _ = mgr.enqueue(gen, Frame::control(MsgType::Pong));
        }
        MsgType::Hello => {
            use crate::sidecar::protocol::{HelloPayload, PROTOCOL_VERSION};
            let parsed: Result<HelloPayload, _> = decode_cbor(&frame.payload);
            match parsed {
                Ok(h) => {
                    if h.protocol_version != PROTOCOL_VERSION {
                        tracing::error!(
                            tauri_proto = PROTOCOL_VERSION,
                            sidecar_proto = h.protocol_version,
                            sidecar_version = %h.sidecar_version,
                            "sidecar protocol version mismatch — incompatible binary"
                        );
                        // Reader thread'den shutdown() ÇAĞIRMA (kendi
                        // handle'ını join ederdi). Çağıran teardown yapar.
                        return false;
                    }
                    tracing::info!(
                        sidecar_version = %h.sidecar_version,
                        capabilities = ?h.capabilities,
                        "sidecar handshake OK"
                    );
                    if h.capabilities.iter().any(|c| c == CAP_FLOW_CREDIT) {
                        let enabled = {
                            let mut inner = mgr.inner.lock();
                            if inner.running && inner.generation == gen {
                                inner.flow_credit = true;
                                true
                            } else {
                                false
                            }
                        };
                        if enabled {
                            // Pane 0 + boş payload = credit modunu aç.
                            let _ = mgr.enqueue(gen, Frame::control(MsgType::FlowResume));
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "HELLO frame decode failed");
                }
            }
        }
        // Sidecar→Tauri yönünde anlam taşımayan tipler
        _ => {}
    }
    true
}

fn spawn_stderr_thread(stderr: std::process::ChildStderr) -> Option<thread::JoinHandle<()>> {
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
    match result {
        Ok(h) => Some(h),
        Err(e) => {
            tracing::warn!(error = %e, "failed to spawn sidecar stderr thread (logs will be lost)");
            None
        }
    }
}

fn spawn_heartbeat_thread(
    weak: Weak<SidecarManager>,
    gen: u64,
    stop: Arc<AtomicBool>,
) -> Option<thread::JoinHandle<()>> {
    let weak_for_err = weak.clone();
    let result = thread::Builder::new()
        .name("dterm-sidecar-heartbeat".into())
        .spawn(move || {
            // System sleep/suspend sırasında bu thread de sidecar da donar.
            // Uyanışta PONG eski görünür → yanlışlıkla "ölü" sayılmasın diye
            // iterasyonlar arası gerçek süre ölçülür ve watchdog sıfırlanır.
            // Gerçek timeout'ta bile sidecar ÖLDÜRÜLMEZ (uzun süren job'lar
            // yanmasın) — yalnızca SidecarDown emit edilir; gerçekten ölü ise
            // reader EOF / writer hatası teardown yapar.
            //
            // `park_timeout` ile beklenir: teardown/shutdown thread'i unpark
            // eder ve stop bayrağı set edildiği için join anında döner.
            const PEER_TIMEOUT: Duration = Duration::from_secs(30);
            const SLEEP_DETECT: Duration = Duration::from_secs(15);
            let mut last_loop = Instant::now();
            let mut next_tick = Instant::now() + HEARTBEAT_INTERVAL;
            let mut down_emitted = false;
            loop {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                let now = Instant::now();
                if now < next_tick {
                    thread::park_timeout(next_tick - now);
                    continue;
                }
                next_tick = now + HEARTBEAT_INTERVAL;
                let Some(mgr) = weak.upgrade() else { break };

                let actual_elapsed = last_loop.elapsed();
                last_loop = Instant::now();
                if actual_elapsed > SLEEP_DETECT {
                    tracing::info!(
                        actual_ms = actual_elapsed.as_millis() as u64,
                        "heartbeat detected system sleep/suspend — resetting peer watchdog"
                    );
                    mgr.inner.lock().last_pong = Instant::now();
                } else {
                    let last = mgr.inner.lock().last_pong;
                    if last.elapsed() > PEER_TIMEOUT {
                        if !down_emitted {
                            tracing::warn!(
                                last_pong_ms = last.elapsed().as_millis() as u64,
                                "heartbeat: peer silent past timeout — emitting SidecarDown (non-destructive)"
                            );
                            try_send_lifecycle(
                                &mgr.events_tx,
                                PtyEvent::SidecarDown {
                                    reason: "heartbeat timeout".into(),
                                },
                            );
                            down_emitted = true;
                        }
                    } else if down_emitted {
                        tracing::info!("heartbeat: peer recovered after silence — emitting SidecarUp");
                        try_send_lifecycle(&mgr.events_tx, PtyEvent::SidecarUp);
                        down_emitted = false;
                    }
                }
                if mgr.enqueue(gen, Frame::control(MsgType::Ping)).is_err() {
                    break;
                }
            }
        });
    match result {
        Ok(h) => Some(h),
        Err(e) => {
            tracing::error!(error = %e, "failed to spawn sidecar heartbeat thread");
            if let Some(mgr) = weak_for_err.upgrade() {
                try_send_lifecycle(
                    &mgr.events_tx,
                    PtyEvent::SidecarDown {
                        reason: format!("heartbeat thread spawn failed: {e}"),
                    },
                );
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdout_event_serializes_data_as_base64() {
        let ev = PtyEvent::Stdout {
            pane_id: "7".into(),
            data: b"hi\x00\xff".to_vec(),
        };
        let json = serde_json::to_value(&ev).unwrap();
        assert_eq!(json["kind"], "stdout");
        assert_eq!(json["pane_id"], "7");
        assert_eq!(json["data"], "aGkA/w==");
        let back: PtyEvent = serde_json::from_value(json).unwrap();
        match back {
            PtyEvent::Stdout { data, .. } => assert_eq!(data, b"hi\x00\xff"),
            _ => panic!("expected stdout"),
        }
    }

    fn node_available() -> bool {
        Command::new("node")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn fake_sidecar(name: &str, body: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dterm-sidecar-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(format!("{name}.js"));
        std::fs::write(&p, body).unwrap();
        p
    }

    fn recv_until<F: Fn(&PtyEvent) -> bool>(rx: &Receiver<PtyEvent>, pred: F) -> Option<PtyEvent> {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if let Ok(ev) = rx.recv_timeout(Duration::from_millis(100)) {
                if pred(&ev) {
                    return Some(ev);
                }
            }
        }
        None
    }

    /// Sidecar SPAWN'dan sonra ölürse pane slot'u serbest kalmalı, frontend'e
    /// Exit gitmeli ve bir sonraki spawn yeni sidecar başlatmalı.
    #[cfg(debug_assertions)]
    #[test]
    fn sidecar_death_frees_panes_and_restarts() {
        if !node_available() {
            eprintln!("node not available — skipping");
            return;
        }
        // stdin'den ilk veri gelince çık (SPAWN alındıktan sonra ölüm).
        let script = fake_sidecar("dies", "process.stdin.once('data', () => process.exit(0));");
        let mgr = SidecarManager::new(script, ProcessJail::new(true));
        let rx = mgr.take_event_receiver().unwrap();
        let payload = SpawnPayload {
            shell: "cmd.exe".into(),
            args: vec![],
            cwd: None,
            env: vec![],
            cols: 80,
            rows: 24,
        };
        let pane = mgr.spawn_pane(payload.clone()).unwrap();
        let exit = recv_until(&rx, |e| matches!(e, PtyEvent::Exit { .. }));
        match exit {
            Some(PtyEvent::Exit {
                pane_id, signal, ..
            }) => {
                assert_eq!(pane_id, pane.to_string());
                assert_eq!(signal.as_deref(), Some("sidecar_lost"));
            }
            other => panic!("expected Exit, got {other:?}"),
        }
        assert_eq!(mgr.pane_count(), 0);
        // Yeni spawn yeni bir sidecar generation'ı başlatmalı (EPIPE değil).
        let pane2 = mgr.spawn_pane(payload).unwrap();
        assert!(pane2 > pane);
        mgr.shutdown();
    }

    /// Gerçek `sidecar/pty-bridge.js` ile uçtan uca: HELLO (CBOR) handshake,
    /// node-pty yokken SPAWN → ERROR(spawn_failed) + EXIT ve slot'un
    /// serbest kalması. cbor-x kurulu değilse atlanır.
    #[cfg(debug_assertions)]
    #[test]
    fn real_sidecar_spawn_failure_frees_slot() {
        let sidecar_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("sidecar");
        let has_cbor = Command::new("node")
            .args(["-e", "require.resolve('cbor-x')"])
            .current_dir(&sidecar_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        let has_pty = Command::new("node")
            .args(["-e", "require('node-pty')"])
            .current_dir(&sidecar_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(true);
        if !has_cbor || has_pty {
            eprintln!("needs node + cbor-x and no working node-pty — skipping");
            return;
        }
        let mgr = SidecarManager::new(sidecar_dir.join("pty-bridge.js"), ProcessJail::new(true));
        let rx = mgr.take_event_receiver().unwrap();
        let pane = mgr
            .spawn_pane(SpawnPayload {
                shell: "cmd.exe".into(),
                args: vec![],
                cwd: None,
                env: vec![],
                cols: 80,
                rows: 24,
            })
            .unwrap();
        let err = recv_until(&rx, |e| matches!(e, PtyEvent::Error { .. }));
        match err {
            Some(PtyEvent::Error { pane_id, code, .. }) => {
                assert_eq!(pane_id, Some(pane.to_string()));
                assert_eq!(code, "spawn_failed");
            }
            other => panic!("expected Error, got {other:?}"),
        }
        let exit = recv_until(&rx, |e| matches!(e, PtyEvent::Exit { .. }));
        assert!(
            matches!(exit, Some(PtyEvent::Exit { exit_code: -1, .. })),
            "{exit:?}"
        );
        assert_eq!(mgr.pane_count(), 0);
        // Sidecar ayakta kalmalı (tek hata tüm sidecar'ı düşürmez) ve credit
        // modu HELLO capability'si ile açılmış olmalı.
        assert!(mgr.inner.lock().running);
        assert!(mgr.inner.lock().flow_credit);
        mgr.shutdown();
    }

    #[test]
    fn oversized_frame_is_rejected_before_write() {
        let mgr = SidecarManager::new("nonexistent".into(), ProcessJail::new(true));
        let err = mgr
            .enqueue(1, Frame::new(MsgType::Stdin, 1, vec![0u8; MAX_PAYLOAD + 1]))
            .unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
    }

    #[test]
    fn write_to_unknown_pane_is_pane_not_found() {
        let mgr = SidecarManager::new("nonexistent".into(), ProcessJail::new(true));
        assert!(matches!(
            mgr.write_stdin(42, b"x"),
            Err(AppError::PaneNotFound(_))
        ));
        // Sidecar yokken resize/kill sessizce Ok.
        assert!(mgr.resize(42, 80, 24).is_ok());
        assert!(mgr.kill(42).is_ok());
    }

    #[test]
    fn join_threads_skips_the_calling_thread() {
        // Bir thread kendi JoinHandle'ını içeren listeyi join etmeye çalışırsa
        // (Drop → shutdown reader thread'inde çalıştığında olduğu gibi)
        // takılmamalı.
        let (handles_tx, handles_rx) = std::sync::mpsc::channel::<Vec<thread::JoinHandle<()>>>();
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        let h = thread::spawn(move || {
            let hs = handles_rx.recv().unwrap();
            join_threads(hs);
            done_tx.send(()).unwrap();
        });
        handles_tx.send(vec![h]).unwrap();
        assert!(done_rx.recv_timeout(Duration::from_secs(5)).is_ok());
    }
}
