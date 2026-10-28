#!/usr/bin/env node
// D-Terminal PTY Bridge (sidecar).
//
// node-pty üzerinden PTY process'lerini multipleks edip stdin/stdout üzerinden
// length-prefixed binary frame protokolüyle Tauri ana process'ine bağlar.
//
// Wire protokolü için bkz. ADR-0001
// (docs/adr/0001-pty-sidecar-ipc-protocol.md).
//
// Process isolation: Bu sidecar process'i Tauri tarafında `ProcessJail` Job
// Object'ine assign edilir. Job `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK` ile
// kurulur: sidecar'ın kendisi job üyesidir (D-Terminal abrupt kapanırsa
// kernel sidecar'ı öldürür) ama spawn ettiği ConPTY host + shell'ler job'a
// dahil DEĞİLDİR. Sidecar ölünce pseudoconsole kapanır ve shell'ler
// CTRL_CLOSE_EVENT ile sonlanır; kullanıcının terminalden başlattığı GUI
// uygulamaları (notepad, `code .`) ise D-Terminal kapanınca öldürülmez.
// Detay: ADR-0006.

'use strict';

const { Buffer } = require('node:buffer');

/** Sidecar sürümü — tek kaynak sidecar/package.json (pkg bundle'a dahil). */
const SIDECAR_VERSION = (() => {
  try {
    return require('./package.json').version;
  } catch {
    return '0.0.0';
  }
})();

// pkg-bundle bootstrap: pkg snapshot fs içindeki .node binding'ler + conpty
// helper'ları (conpty.dll, OpenConsole.exe) gerçek dosya sistemine extract
// edilir. node-pty'nin C++ tarafı (conpty.cc) `conpty/conpty.dll`'yi
// pty.node'un yanında arar — pkg'nin .node extract'i bu yapıyı korumaz.
//
// Güvenlik / sağlamlık:
//  - Hedef: %LOCALAPPDATA%\D-Terminal\pty-natives\<sürüm>\<arch> (paylaşılan
//    %TEMP% yerine kullanıcıya özel, sürüm bazlı klasör → upgrade sonrası
//    eski ABI'li binary yeniden kullanılmaz).
//  - Mevcut dosya her açılışta snapshot içeriğinin SHA-256'sı ile
//    karşılaştırılır; farklıysa (bozuk / değiştirilmiş) yeniden yazılır.
//  - Yazma geçici dosyaya yapılıp atomik rename edilir → iki instance
//    yarım yazılmış dosyayı yüklemez.
if (process.pkg) {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const crypto = require('node:crypto');
  const Module = require('node:module');

  const arch = `${process.platform}-${process.arch}`;
  const baseDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'D-Terminal', 'pty-natives')
    : path.join(os.tmpdir(), 'dterminal-pty-bridge-natives');
  const nativesDir = path.join(baseDir, SIDECAR_VERSION, arch);
  const conptyDir = path.join(nativesDir, 'conpty');
  const logFile = path.join(baseDir, 'bootstrap.log');

  fs.mkdirSync(conptyDir, { recursive: true });
  const logBoot = (msg) => {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch { /* noop */ }
  };

  const snapshotPrebuild = path.join(
    __dirname,
    'node_modules/node-pty/prebuilds',
    arch,
  );

  const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

  const extractVerified = (src, dst) => {
    try {
      const want = fs.readFileSync(src);
      const wantHash = sha256(want);
      try {
        if (sha256(fs.readFileSync(dst)) === wantHash) return;
        logBoot(`hash mismatch, rewriting ${path.basename(dst)}`);
      } catch { /* yok — yaz */ }
      const tmp = `${dst}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(tmp, want);
      try {
        fs.renameSync(tmp, dst);
      } catch (e) {
        // Windows: hedef başka bir instance tarafından yüklü (kilitli) olabilir.
        // O durumda mevcut dosya zaten doğru sürümü taşıyorsa sorun yok.
        try { fs.unlinkSync(tmp); } catch { /* noop */ }
        if (sha256(fs.readFileSync(dst)) !== wantHash) throw e;
      }
      logBoot(`extracted ${path.basename(dst)}`);
    } catch (e) {
      logBoot(`extract FAILED ${src}: ${e.message}`);
      process.stderr.write(`[pty-bridge] native extract failed (${path.basename(src)}): ${e.message}\n`);
    }
  };

  for (const name of ['pty.node', 'conpty.node', 'conpty_console_list.node']) {
    extractVerified(path.join(snapshotPrebuild, name), path.join(nativesDir, name));
  }
  for (const name of ['conpty.dll', 'OpenConsole.exe']) {
    extractVerified(
      path.join(snapshotPrebuild, 'conpty', name),
      path.join(conptyDir, name),
    );
  }

  // node-pty/lib/utils.js dinamik olarak `prebuilds/<plat>-<arch>/<name>.node`
  // çağırır. Bu istekleri gerçek fs'teki extract'e yönlendir.
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function patchedResolve(request, parent, ...rest) {
    if (typeof request === 'string' && request.endsWith('.node')) {
      const baseName = path.basename(request);
      const real = path.join(nativesDir, baseName);
      if (fs.existsSync(real)) return real;
    }
    return originalResolve.call(this, request, parent, ...rest);
  };
}

// node-pty opsiyonel: protokol katmanı bağımsız çalıştırılabilir/test edilebilir.
let pty = null;
try {
  pty = require('node-pty');
} catch {
  // sadece protocol-only test modunda; spawn istenirse hata atılır.
}

// --- Protokol sabitleri --------------------------------------------------

const MAX_PAYLOAD = 16 * 1024 * 1024; // 16 MB
const HEADER_LEN = 13;                // 4 (len) + 1 (type) + 8 (pane_id)

const MsgType = Object.freeze({
  HELLO:       0x00,
  SPAWN:       0x01,
  STDIN:       0x02,
  STDOUT:      0x03,
  RESIZE:      0x04,
  KILL:        0x05,
  EXIT:        0x06,
  PING:        0x07,
  PONG:        0x08,
  ERROR:       0x09,
  FLOW_RESUME: 0x0A,
});

/** Protokol versiyonu — Tauri PROTOCOL_VERSION ile eşleşmeli. Breaking change'lerde
 *  ikisi birden bump'lanır. Eklemeli (additive) özellikler HELLO
 *  `capabilities` listesiyle müzakere edilir. */
const PROTOCOL_VERSION = 1;

/** HELLO'da ilan edilen opsiyonel yetenekler. */
const CAPABILITIES = Object.freeze(['flow_credit']);

/** Credit tabanlı akış kontrolü: bir pane'in Tauri tarafından henüz
 *  onaylanmamış (FLOW_RESUME ile ack'lenmemiş) çıktısı HIGH_WATER'ı aşınca
 *  PTY okuması duraklatılır, LOW_WATER'ın altına inince devam eder. Böylece
 *  tek bir `cat huge.log` diğer pane'leri / UI'ı boğamaz. */
const FLOW_HIGH_WATER = 1024 * 1024;     // 1 MB
const FLOW_LOW_WATER = 256 * 1024;       // 256 KB

const KNOWN_TYPES = new Set(Object.values(MsgType));

/** Shell'lere sızmaması gereken, sidecar / Tauri'ye ait iç env değişkenleri. */
const INTERNAL_ENV_PREFIXES = ['PKG_', 'TAURI_', '__TAURI', 'DTERMINAL_SIDECAR'];
const INTERNAL_ENV_KEYS = new Set(['PKG_EXECPATH', 'NODE_PTY_DEBUG']);

function sanitizeEnv(base) {
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const upper = k.toUpperCase();
    if (INTERNAL_ENV_KEYS.has(upper)) continue;
    if (INTERNAL_ENV_PREFIXES.some((p) => upper.startsWith(p))) continue;
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// --- Frame encode/decode -------------------------------------------------

/**
 * Frame'i Buffer olarak serialize et.
 * @param {number} msgType - MsgType.*
 * @param {bigint|number} paneId - 64-bit pane id
 * @param {Buffer|Uint8Array|string} payload
 * @returns {Buffer}
 */
function encodeFrame(msgType, paneId, payload = Buffer.alloc(0)) {
  if (!KNOWN_TYPES.has(msgType)) {
    throw new Error(`unknown msg type: 0x${msgType.toString(16)}`);
  }
  const payloadBuf = toBuffer(payload);
  if (payloadBuf.length > MAX_PAYLOAD) {
    throw new Error(`payload too large: ${payloadBuf.length} bytes`);
  }
  const buf = Buffer.allocUnsafe(HEADER_LEN + payloadBuf.length);
  buf.writeUInt32BE(payloadBuf.length, 0);
  buf.writeUInt8(msgType, 4);
  buf.writeBigUInt64BE(BigInt(paneId), 5);
  payloadBuf.copy(buf, HEADER_LEN);
  return buf;
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (typeof input === 'string') return Buffer.from(input, 'utf8');
  throw new TypeError('payload must be Buffer, Uint8Array, or string');
}

/** Stream senkronunun kaybolduğunu belirten, kurtarılamaz decode hatası. */
class FatalDecodeError extends Error {}

/**
 * Akış tabanlı frame decoder. Buffer'ı besle, frame geldikçe döndür.
 *
 * - Chunk'lar bir listede biriktirilir ve yalnızca bir sonraki frame'i
 *   tamamlayacak kadar veri geldiğinde birleştirilir (eski her-chunk-concat
 *   O(n²) davranışı yerine O(n)).
 * - Bilinmeyen mesaj tipi: uzunluk bilindiği için frame atlanır ve stream
 *   senkronu korunur (ileri uyumluluk) — `onUnknown` callback'i bildirilir.
 * - MAX_PAYLOAD üstü uzunluk: stream güvenilmez → iç buffer sıfırlanır ve
 *   FatalDecodeError fırlatılır (decoder "zehirlenmiş" halde kalmaz).
 */
class FrameDecoder {
  constructor({ onUnknown } = {}) {
    /** @type {Buffer[]} */
    this._chunks = [];
    this._len = 0;
    /** Bir sonraki frame'i tamamlamak için gereken toplam byte (0 = bilinmiyor). */
    this._need = 0;
    this._onUnknown = onUnknown ?? null;
  }

  /** Buffer'daki bekleyen byte sayısı (test/diagnostic). */
  get pending() {
    return this._len;
  }

  reset() {
    this._chunks = [];
    this._len = 0;
    this._need = 0;
  }

  /**
   * @param {Buffer} chunk
   * @returns {Array<{msgType:number, paneId:bigint, payload:Buffer}>}
   */
  feed(chunk) {
    if (chunk.length === 0) return [];
    this._chunks.push(chunk);
    this._len += chunk.length;
    if (this._len < Math.max(this._need, HEADER_LEN)) return [];

    const buf = this._chunks.length === 1 ? this._chunks[0] : Buffer.concat(this._chunks, this._len);
    this._chunks = [];
    this._len = 0;
    this._need = 0;

    const out = [];
    let off = 0;
    while (buf.length - off >= HEADER_LEN) {
      const len = buf.readUInt32BE(off);
      if (len > MAX_PAYLOAD) {
        this.reset();
        throw new FatalDecodeError(`payload too large in stream: ${len}`);
      }
      const total = HEADER_LEN + len;
      if (buf.length - off < total) {
        this._need = total;
        break;
      }
      const msgType = buf.readUInt8(off + 4);
      const paneId = buf.readBigUInt64BE(off + 5);
      if (KNOWN_TYPES.has(msgType)) {
        // subarray view → bağımsız kopya al; arkadaki buffer yeniden kullanılabilir
        out.push({ msgType, paneId, payload: Buffer.from(buf.subarray(off + HEADER_LEN, off + total)) });
      } else if (this._onUnknown) {
        this._onUnknown(msgType, paneId);
      }
      off += total;
    }
    if (off < buf.length) {
      const rest = buf.subarray(off);
      this._chunks.push(rest);
      this._len = rest.length;
    }
    return out;
  }
}

// --- CBOR ----------------------------------------------------------------

// Rust tarafı (ciborium) CBOR konuşur. cbor-x yoksa yalnızca protokol testleri
// (require ile kütüphane olarak yüklenince) JSON fallback'i kullanır; gerçek
// sidecar (`runMain`) cbor-x olmadan çalışmayı reddeder — sessizce JSON'a
// düşmek her SPAWN'ın Rust'ta decode hatasıyla başarısız olmasına yol açardı.
const cborEncoder = (() => {
  try {
    const { encode, decode } = require('cbor-x');
    return { encode, decode };
  } catch {
    return null;
  }
})();

function encodePayload(obj) {
  if (cborEncoder) return cborEncoder.encode(obj);
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

function decodePayload(buf) {
  if (cborEncoder) return cborEncoder.decode(buf);
  return JSON.parse(buf.toString('utf8'));
}

// --- PTY Manager (multiplexer) -----------------------------------------

class PtyManager {
  constructor({ writeFrame, log, ptyImpl = pty }) {
    /** @type {Map<string, {proc: import('node-pty').IPty, unacked: number, paused: boolean}>} */
    this._panes = new Map();
    this._writeFrame = writeFrame;
    this._log = log;
    this._pty = ptyImpl;
    /** Tauri credit (FLOW_RESUME ack) gönderiyor mu — HELLO sonrası pane 0
     *  FLOW_RESUME ile etkinleşir. Eski Tauri ack göndermezse pane'ler
     *  sonsuza dek duraklamasın diye varsayılan kapalı. */
    this._creditMode = false;
    /** stdout pipe'ı doldu ('drain' bekleniyor) → tüm pane'ler duraklar. */
    this._drainWait = false;
  }

  spawn(paneId, payload) {
    if (!this._pty) {
      throw new Error('node-pty not available — install dependencies first');
    }
    const key = String(paneId);
    if (this._panes.has(key)) {
      const err = new Error(`pane ${key} already exists`);
      err.paneAlive = true;
      throw err;
    }
    if (!payload || typeof payload.shell !== 'string' || payload.shell.length === 0) {
      throw new Error('spawn: shell missing');
    }
    const extraEnv = Array.isArray(payload.env) ? payload.env : [];
    const proc = this._pty.spawn(payload.shell, Array.isArray(payload.args) ? payload.args : [], {
      cwd: payload.cwd ?? process.cwd(),
      env: { ...sanitizeEnv(process.env), ...Object.fromEntries(extraEnv) },
      cols: payload.cols ?? 80,
      rows: payload.rows ?? 24,
      name: 'xterm-256color',
      useConpty: true, // Windows: ConPTY (Win10 1809+)
    });
    const entry = { proc, unacked: 0, paused: false };
    this._panes.set(key, entry);

    proc.onData((data) => {
      // node-pty 'data' verisi string. Binary güvenli olması için Buffer'a çevir.
      const buf = Buffer.from(data, 'utf8');
      entry.unacked += buf.length;
      this._writeFrame(MsgType.STDOUT, paneId, buf);
      this._updatePause(entry);
    });
    proc.onExit(({ exitCode, signal }) => {
      if (this._panes.get(key) === entry) this._panes.delete(key);
      this._writeFrame(
        MsgType.EXIT,
        paneId,
        encodePayload({
          exit_code: Number.isInteger(exitCode) ? exitCode : 0,
          // Rust ExitPayload.signal: Option<String> — sayı gelirse string'e çevir.
          signal: signal ? String(signal) : null,
        }),
      );
    });

    this._log(`spawned pane ${key}: ${payload.shell}`);
  }

  write(paneId, data) {
    const entry = this._panes.get(String(paneId));
    if (!entry) return; // sessiz drop — pane çoktan kapanmış olabilir
    entry.proc.write(data.toString('utf8'));
  }

  resize(paneId, cols, rows) {
    const entry = this._panes.get(String(paneId));
    if (!entry) return;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
    entry.proc.resize(cols, rows);
  }

  kill(paneId) {
    const entry = this._panes.get(String(paneId));
    if (!entry) return;
    try {
      entry.proc.kill();
    } finally {
      // EXIT frame'i onExit'ten gelir; map'ten burada sil ki aynı id tekrar
      // kullanılamasın.
      this._panes.delete(String(paneId));
    }
  }

  killAll() {
    for (const [, entry] of this._panes) {
      try { entry.proc.kill(); } catch { /* yutulur */ }
    }
    this._panes.clear();
  }

  has(paneId) {
    return this._panes.has(String(paneId));
  }

  size() {
    return this._panes.size;
  }

  /** Tauri credit modunu açtı (pane 0 FLOW_RESUME). */
  enableCreditMode() {
    this._creditMode = true;
  }

  /** Tauri `bytes` kadar çıktıyı tükettiğini bildirdi. */
  ack(paneId, bytes) {
    const entry = this._panes.get(String(paneId));
    if (!entry) return;
    entry.unacked = Math.max(0, entry.unacked - (Number.isFinite(bytes) ? bytes : 0));
    this._updatePause(entry);
  }

  /** stdout.write() false döndü → 'drain' gelene kadar herkesi duraklat. */
  setDrainWait(waiting) {
    if (this._drainWait === waiting) return;
    this._drainWait = waiting;
    for (const [, entry] of this._panes) this._updatePause(entry);
  }

  _updatePause(entry) {
    let shouldPause = this._drainWait;
    if (this._creditMode) {
      if (entry.unacked >= FLOW_HIGH_WATER) shouldPause = true;
      else if (entry.paused && entry.unacked > FLOW_LOW_WATER) shouldPause = true;
    }
    if (shouldPause === entry.paused) return;
    entry.paused = shouldPause;
    try {
      if (shouldPause) entry.proc.pause();
      else entry.proc.resume();
    } catch { /* pause/resume desteklenmiyorsa yut */ }
  }
}

// --- Dispatch ------------------------------------------------------------

/**
 * Tek bir frame'i işle. Hata fırlatmaz: hata durumunda ilgili pane için ERROR
 * (ve SPAWN başarısızsa EXIT) frame'i gönderir, böylece aynı chunk'taki diğer
 * frame'ler işlenmeye devam eder ve Rust tarafı pane slot'unu serbest bırakır.
 */
function dispatch(frame, manager, writeFrame, log) {
  const { msgType, paneId, payload } = frame;
  try {
    switch (msgType) {
      case MsgType.SPAWN: {
        const spec = decodePayload(payload);
        manager.spawn(paneId, spec);
        break;
      }
      case MsgType.STDIN:
        manager.write(paneId, payload);
        break;
      case MsgType.RESIZE: {
        const { cols, rows } = decodePayload(payload);
        manager.resize(paneId, cols, rows);
        break;
      }
      case MsgType.KILL:
        manager.kill(paneId);
        break;
      case MsgType.PING:
        writeFrame(MsgType.PONG, 0n, Buffer.alloc(0));
        break;
      case MsgType.PONG:
        // peer'ın yanıtı — lastTauriContact stdin 'data' handler'ında güncellenir
        break;
      case MsgType.FLOW_RESUME: {
        if (paneId === 0n) {
          manager.enableCreditMode();
        } else {
          const { bytes } = payload.length > 0 ? decodePayload(payload) : { bytes: Infinity };
          manager.ack(paneId, bytes);
        }
        break;
      }
      default:
        log(`ignored msg type: 0x${msgType.toString(16)}`);
    }
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log(`dispatch error (type 0x${msgType.toString(16)}, pane ${paneId}): ${message}`);
    const code = msgType === MsgType.SPAWN ? 'spawn_failed' : 'dispatch_error';
    try {
      writeFrame(MsgType.ERROR, paneId, encodePayload({ code, message }));
      if (msgType === MsgType.SPAWN && paneId !== 0n && !(err && err.paneAlive)) {
        // Rust tarafı EXIT'te pane slot'unu siler ve frontend'e bildirir.
        writeFrame(MsgType.EXIT, paneId, encodePayload({ exit_code: -1, signal: 'spawn_failed' }));
      }
    } catch (e) {
      log(`error report failed: ${e.message}`);
    }
  }
}

// --- Main loop -----------------------------------------------------------

function runMain() {
  const log = (msg) => process.stderr.write(`[pty-bridge] ${msg}\n`);

  if (!cborEncoder) {
    // Rust CBOR konuşur; JSON fallback ile çalışmak her SPAWN'ı bozar.
    log('FATAL: cbor-x not available — refusing to start (protocol requires CBOR)');
    process.exit(2);
  }

  let manager = null;
  const writeFrame = (msgType, paneId, payload) => {
    const frame = encodeFrame(msgType, paneId, payload);
    const ok = process.stdout.write(frame);
    if (!ok && manager) manager.setDrainWait(true);
    return ok;
  };
  process.stdout.on('drain', () => {
    if (manager) manager.setDrainWait(false);
  });

  manager = new PtyManager({ writeFrame, log });
  const decoder = new FrameDecoder({
    onUnknown: (type, paneId) => log(`skipped unknown msg type 0x${type.toString(16)} (pane ${paneId})`),
  });

  // HELLO handshake — Tauri tarafına protokol versiyon + sidecar binary
  // versiyonunu ilet. Tauri uyumsuzluk tespit ederse SidecarDown emit edip
  // child'i kapatır. Uyum varsa info loglar ve normal akışa geçer.
  try {
    const helloPayload = encodePayload({
      protocol_version: PROTOCOL_VERSION,
      sidecar_version: SIDECAR_VERSION,
      capabilities: CAPABILITIES,
    });
    writeFrame(MsgType.HELLO, 0n, helloPayload);
  } catch (e) {
    log(`HELLO write failed: ${e.message}`);
  }

  // Heartbeat (iki yönlü):
  //  - Tauri 5s'de bir PING gönderir, sidecar PONG döner (dispatch'te).
  //  - Sidecar 5s'de bir PING gönderir, Tauri PONG döner (manager.rs).
  //  - Sidecar son Tauri temasını izler. Sessizlik uzun sürerse UYARI ver —
  //    ama PTY'leri ÖLDÜRME (uzun süren job'ları yakmamak için); Tauri
  //    gerçekten ölmüşse stdout EPIPE / stdin 'end' bizi temizler.
  //
  // System sleep/suspend: setInterval host uyurken donar; uyanışta
  // tick'ler arası gerçek aralık ölçülür ve watchdog sıfırlanır.
  let lastTauriContact = Date.now();
  let lastTick = Date.now();
  let peerTimeoutLogged = false;
  const HEARTBEAT_MS = 5000;
  const PEER_TIMEOUT_MS = 30000;
  const SLEEP_DETECT_MS = 15000;

  let shuttingDown = false;
  const shutdown = (reason, code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(heartbeat);
    log(`shutdown: ${reason}`);
    manager.killAll();
    // node-pty'nin Windows kill'i asenkron (ConPTY kapanışı + console-list
    // fork'u). Hemen process.exit etmek torun process'leri yetim bırakabilir;
    // kısa bir süre tanı, sonra çık. unref → başka iş yoksa daha erken biter.
    setTimeout(() => process.exit(code), 500).unref();
  };

  const heartbeat = setInterval(() => {
    const now = Date.now();
    const sinceLastTick = now - lastTick;
    lastTick = now;
    if (sinceLastTick > SLEEP_DETECT_MS) {
      log(`detected sleep/suspend (${sinceLastTick}ms tick gap) — resetting peer watchdog`);
      lastTauriContact = now;
      peerTimeoutLogged = false;
    }
    try {
      writeFrame(MsgType.PING, 0n, Buffer.alloc(0));
    } catch (e) {
      log(`heartbeat write failed: ${e.message}`);
      shutdown('stdout write failed');
      return;
    }
    const silenceMs = now - lastTauriContact;
    if (silenceMs > PEER_TIMEOUT_MS) {
      if (!peerTimeoutLogged) {
        log(`peer (Tauri) silent for ${silenceMs}ms — NOT exiting; PTYs preserved`);
        peerTimeoutLogged = true;
      }
    } else if (peerTimeoutLogged) {
      log('peer (Tauri) recovered after silence');
      peerTimeoutLogged = false;
    }
  }, HEARTBEAT_MS);

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.stdin.on('end', () => shutdown('stdin closed'));
  process.stdout.on('error', (e) => {
    if (e && e.code === 'EPIPE') shutdown('stdout EPIPE');
  });

  process.stdin.on('data', (chunk) => {
    lastTauriContact = Date.now();
    let frames;
    try {
      frames = decoder.feed(chunk);
    } catch (err) {
      // Stream senkronu kayboldu (ör. bozuk uzunluk alanı). Decoder kendini
      // sıfırladı ama byte hizası artık bilinmiyor — devam etmek her sonraki
      // frame'i yanlış yorumlar. Fatal ERROR gönder ve çık; Rust reader EOF
      // görür, pane'leri temizler ve sonraki spawn'da sidecar'ı yeniden başlatır.
      log(`fatal decode error: ${err.message}`);
      try {
        writeFrame(MsgType.ERROR, 0n, encodePayload({ code: 'decode_fatal', message: err.message }));
      } catch { /* noop */ }
      shutdown('decode error', 1);
      return;
    }
    for (const frame of frames) {
      dispatch(frame, manager, writeFrame, log);
    }
  });

  log(`ready — pid ${process.pid} (v${SIDECAR_VERSION})`);
}

// Entrypoint when run directly (not when required as a library for tests).
if (require.main === module) {
  runMain();
}

module.exports = {
  MsgType,
  MAX_PAYLOAD,
  HEADER_LEN,
  PROTOCOL_VERSION,
  SIDECAR_VERSION,
  FLOW_HIGH_WATER,
  FLOW_LOW_WATER,
  encodeFrame,
  FrameDecoder,
  FatalDecodeError,
  encodePayload,
  decodePayload,
  sanitizeEnv,
  dispatch,
  PtyManager,
};
