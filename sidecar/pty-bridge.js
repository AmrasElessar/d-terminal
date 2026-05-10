#!/usr/bin/env node
// D-Terminal PTY Bridge (sidecar).
//
// node-pty üzerinden PTY process'lerini multipleks edip stdin/stdout üzerinden
// length-prefixed binary frame protokolüyle Tauri ana process'ine bağlar.
//
// Wire protokolü için bkz. ADR-0001
// (docs/adr/0001-pty-sidecar-ipc-protocol.md).
//
// Process isolation (v0.9.6+): Bu sidecar process'i Tauri tarafında
// `ProcessJail` Job Object'ine assign edilir (`AssignProcessToJobObject`).
// `JOB_OBJECT_LIMIT_BREAKAWAY_OK` flag'i SET DEĞİL — yani node-pty.spawn
// ile başlatılan grandchild PTY shell'ler (PowerShell, cmd, wsl) Windows
// kernel tarafından OTOMATIK olarak aynı Job'a inherit edilir. Sonuç:
// D-Terminal abrupt kapanırsa (taskkill /f, kernel panic) kullanıcının
// shell session'ları + onların child'ları (npm, git, vs.) kernel
// tarafından garantili temizlenir. Detay: ADR-0006.

'use strict';

const { Buffer } = require('node:buffer');

// pkg-bundle bootstrap: pkg snapshot fs içindeki .node binding'ler + conpty
// helper'ları (conpty.dll, OpenConsole.exe) gerçek dosya sistemine extract
// edilir. node-pty'nin C++ tarafı (conpty.cc) `conpty/conpty.dll`'yi
// pty.node'un yanında arar — pkg'nin .node extract'i bu yapıyı korumaz.
if (process.pkg) {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const Module = require('node:module');

  const arch = `${process.platform}-${process.arch}`;
  const nativesDir = path.join(os.tmpdir(), 'dterminal-pty-bridge-natives', arch);
  const conptyDir = path.join(nativesDir, 'conpty');
  const logFile = path.join(os.tmpdir(), 'dterminal-pty-bridge-natives', 'bootstrap.log');

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

  const extractIfMissing = (src, dst) => {
    try {
      if (fs.existsSync(dst) && fs.statSync(dst).size > 0) return;
      fs.writeFileSync(dst, fs.readFileSync(src));
      logBoot(`extracted ${path.basename(dst)}`);
    } catch (e) {
      logBoot(`extract FAILED ${src}: ${e.message}`);
      process.stderr.write(`[pty-bridge] native extract failed (${path.basename(src)}): ${e.message}\n`);
    }
  };

  for (const name of ['pty.node', 'conpty.node', 'conpty_console_list.node']) {
    extractIfMissing(path.join(snapshotPrebuild, name), path.join(nativesDir, name));
  }
  for (const name of ['conpty.dll', 'OpenConsole.exe']) {
    extractIfMissing(
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
 *  ikiside birden bumpllanır. */
const PROTOCOL_VERSION = 1;
const SIDECAR_VERSION = '0.9.4'; // sidecar/package.json + Tauri Cargo.toml senkron

const KNOWN_TYPES = new Set(Object.values(MsgType));

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

/**
 * Akış tabanlı frame decoder. Buffer'ı bes, frame geldikçe callback'i çağır.
 */
class FrameDecoder {
  constructor() {
    /** @type {Buffer} */
    this._buf = Buffer.alloc(0);
  }

  /**
   * @param {Buffer} chunk
   * @returns {Array<{msgType:number, paneId:bigint, payload:Buffer}>}
   */
  feed(chunk) {
    this._buf = this._buf.length === 0 ? chunk : Buffer.concat([this._buf, chunk]);
    const out = [];
    while (this._buf.length >= HEADER_LEN) {
      const len = this._buf.readUInt32BE(0);
      if (len > MAX_PAYLOAD) {
        throw new Error(`payload too large in stream: ${len}`);
      }
      const total = HEADER_LEN + len;
      if (this._buf.length < total) break;
      const msgType = this._buf.readUInt8(4);
      if (!KNOWN_TYPES.has(msgType)) {
        throw new Error(`unknown msg type in stream: 0x${msgType.toString(16)}`);
      }
      const paneId = this._buf.readBigUInt64BE(5);
      const payload = this._buf.subarray(HEADER_LEN, total);
      // subarray view → bağımsız kopya almalı, arkadaki buffer'ı kaydırınca geçerliliğini kaybeder
      out.push({ msgType, paneId, payload: Buffer.from(payload) });
      this._buf = this._buf.subarray(total);
    }
    return out;
  }
}

// --- CBOR (minimal — yalnızca ihtiyaç duyulan tipler) -------------------

// node:util TextEncoder/TextDecoder yerleşik. Tam CBOR spec değil — sadece
// SpawnPayload / ResizePayload / ExitPayload / ErrorPayload için yeterli.
// Production'da `cbor-x` veya benzeri eklenebilir; protokol bağımsız.

const cborEncoder = (() => {
  // Lazy require: paket henüz install edilmemiş olabilir; encoder mevcut değilse JSON fallback.
  try {
    const { encode, decode } = require('cbor-x');
    return { encode, decode };
  } catch {
    return null;
  }
})();

function encodePayload(obj) {
  if (cborEncoder) return cborEncoder.encode(obj);
  // Fallback: JSON. Tauri tarafındaki Rust ciborium ile uyum için production'da CBOR şart.
  return Buffer.from(JSON.stringify(obj), 'utf8');
}

function decodePayload(buf) {
  if (cborEncoder) return cborEncoder.decode(buf);
  return JSON.parse(buf.toString('utf8'));
}

// --- PTY Manager (multiplexer) -----------------------------------------

class PtyManager {
  constructor({ writeFrame, log }) {
    /** @type {Map<string, import('node-pty').IPty>} */
    this._panes = new Map();
    this._writeFrame = writeFrame;
    this._log = log;
  }

  spawn(paneId, payload) {
    if (!pty) {
      throw new Error('node-pty not available — install dependencies first');
    }
    const key = String(paneId);
    if (this._panes.has(key)) {
      throw new Error(`pane ${key} already exists`);
    }
    const proc = pty.spawn(payload.shell, payload.args ?? [], {
      cwd: payload.cwd ?? process.cwd(),
      env: { ...process.env, ...Object.fromEntries(payload.env ?? []) },
      cols: payload.cols ?? 80,
      rows: payload.rows ?? 24,
      name: 'xterm-256color',
      useConpty: true, // Windows: ConPTY (Win10 1809+)
    });
    this._panes.set(key, proc);

    proc.onData((data) => {
      // node-pty 'data' verisi string. Binary güvenli olması için Buffer'a çevir.
      this._writeFrame(MsgType.STDOUT, paneId, Buffer.from(data, 'utf8'));
    });
    proc.onExit(({ exitCode, signal }) => {
      this._panes.delete(key);
      this._writeFrame(
        MsgType.EXIT,
        paneId,
        encodePayload({ exit_code: exitCode ?? 0, signal: signal ?? null }),
      );
    });

    this._log(`spawned pane ${key}: ${payload.shell}`);
  }

  write(paneId, data) {
    const proc = this._panes.get(String(paneId));
    if (!proc) return; // sessiz drop — pane çoktan kapanmış olabilir
    proc.write(data.toString('utf8'));
  }

  resize(paneId, cols, rows) {
    const proc = this._panes.get(String(paneId));
    if (!proc) return;
    proc.resize(cols, rows);
  }

  kill(paneId) {
    const proc = this._panes.get(String(paneId));
    if (!proc) return;
    proc.kill();
    this._panes.delete(String(paneId));
  }

  killAll() {
    for (const [, proc] of this._panes) {
      try { proc.kill(); } catch { /* yutulur */ }
    }
    this._panes.clear();
  }

  size() {
    return this._panes.size;
  }
}

// --- Main loop -----------------------------------------------------------

function runMain() {
  const log = (msg) => process.stderr.write(`[pty-bridge] ${msg}\n`);

  // stdout binary mode için: setEncoding null, raw write
  process.stdout.write = process.stdout.write.bind(process.stdout);

  const writeFrame = (msgType, paneId, payload) => {
    const frame = encodeFrame(msgType, paneId, payload);
    process.stdout.write(frame);
  };

  const manager = new PtyManager({ writeFrame, log });
  const decoder = new FrameDecoder();

  // HELLO handshake — Tauri tarafına protokol versiyon + sidecar binary
  // versiyonunu ilet. Tauri uyumsuzluk tespit ederse SidecarDown emit edip
  // child'i kapatır. Uyum varsa info loglar ve normal akışa geçer.
  try {
    const helloPayload = encodePayload({
      protocol_version: PROTOCOL_VERSION,
      sidecar_version: SIDECAR_VERSION,
      capabilities: [], // Gelecek için: ['flow_resume', 'backpressure', ...]
    });
    writeFrame(MsgType.HELLO, 0n, helloPayload);
  } catch (e) {
    log(`HELLO write failed: ${e.message}`);
    // Tauri tarafı stdout'u dinlemiyorsa ileride zaten EPIPE alacak — devam et.
  }

  // Heartbeat (iki yönlü):
  //  - Tauri 5s'de bir PING gönderir, sidecar PONG döner (dispatch'te).
  //  - Sidecar 5s'de bir PING gönderir, Tauri PONG döner (manager.rs).
  //  - Sidecar son Tauri PING/PONG'unu izler. 15s sessizlikte Tauri ölmüş
  //    say ve exit et — yoksa zombi PTY'ler arkada çalışmaya devam eder.
  let lastTauriContact = Date.now();
  const HEARTBEAT_MS = 5000;
  const PEER_TIMEOUT_MS = 15000;

  const heartbeat = setInterval(() => {
    try {
      writeFrame(MsgType.PING, 0n, Buffer.alloc(0));
    } catch (e) {
      log(`heartbeat write failed: ${e.message}`);
      // stdout kapalıysa Tauri zaten yok — shutdown
      shutdown('stdout write failed');
      return;
    }
    if (Date.now() - lastTauriContact > PEER_TIMEOUT_MS) {
      shutdown('peer (Tauri) heartbeat timeout');
    }
  }, HEARTBEAT_MS);

  const shutdown = (reason) => {
    clearInterval(heartbeat);
    manager.killAll();
    log(`shutdown: ${reason}`);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.stdin.on('end', () => shutdown('stdin closed'));
  // Pipe karşı tarafı yazılırken kapanırsa Node stdout'a yazma denemeleri
  // EPIPE atar — yakalanmazsa default davranış crash. Açıkça yakala + shutdown.
  process.stdout.on('error', (e) => {
    if (e && e.code === 'EPIPE') shutdown('stdout EPIPE');
  });

  process.stdin.on('data', (chunk) => {
    // Herhangi bir veri Tauri'nin yaşadığını gösterir
    lastTauriContact = Date.now();
    try {
      for (const frame of decoder.feed(chunk)) {
        dispatch(frame, manager, writeFrame, log);
      }
    } catch (err) {
      log(`decode error: ${err.message}`);
      writeFrame(
        MsgType.ERROR,
        0n,
        encodePayload({ code: 'decode_error', message: err.message }),
      );
    }
  });

  log(`ready — pid ${process.pid}`);
}

function dispatch(frame, manager, writeFrame, log) {
  const { msgType, paneId, payload } = frame;
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
      // peer'ın yanıtı — heartbeat takibi ileride manager'a taşınır
      break;
    case MsgType.FLOW_RESUME:
      // backpressure release; v1.0 manager implementasyonunda kullanılır
      break;
    default:
      log(`ignored msg type: 0x${msgType.toString(16)}`);
  }
}

// Entrypoint when run directly (not when required as a library for tests).
if (require.main === module) {
  runMain();
}

module.exports = {
  MsgType,
  MAX_PAYLOAD,
  HEADER_LEN,
  encodeFrame,
  FrameDecoder,
  encodePayload,
  decodePayload,
  PtyManager,
};
