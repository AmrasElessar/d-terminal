// node:test ile çalışır: `node --test tests/`
//
// Frame encode/decode roundtrip + edge case testleri.
// Rust tarafıyla wire-uyumlu olduğunu sabitliyor.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');

const {
  MsgType,
  MAX_PAYLOAD,
  HEADER_LEN,
  FLOW_HIGH_WATER,
  encodeFrame,
  FrameDecoder,
  decodePayload,
  encodePayload,
  sanitizeEnv,
  dispatch,
  PtyManager,
} = require('../pty-bridge.js');

test('encodeFrame: header layout for empty payload', () => {
  const buf = encodeFrame(MsgType.PING, 0n);
  assert.equal(buf.length, HEADER_LEN);
  assert.equal(buf.readUInt32BE(0), 0);
  assert.equal(buf.readUInt8(4), MsgType.PING);
  assert.equal(buf.readBigUInt64BE(5), 0n);
});

test('encodeFrame: header layout for stdout payload', () => {
  const payload = Buffer.from('hello \x1b[32mworld\x1b[0m', 'utf8');
  const buf = encodeFrame(MsgType.STDOUT, 42n, payload);
  assert.equal(buf.length, HEADER_LEN + payload.length);
  assert.equal(buf.readUInt32BE(0), payload.length);
  assert.equal(buf.readUInt8(4), MsgType.STDOUT);
  assert.equal(buf.readBigUInt64BE(5), 42n);
  assert.deepEqual(buf.subarray(HEADER_LEN), payload);
});

test('encodeFrame: rejects unknown msg type', () => {
  assert.throws(() => encodeFrame(0xFF, 1n, Buffer.alloc(0)), /unknown msg type/);
});

test('encodeFrame: rejects oversized payload', () => {
  const huge = Buffer.alloc(MAX_PAYLOAD + 1);
  assert.throws(() => encodeFrame(MsgType.STDOUT, 1n, huge), /payload too large/);
});

test('encodeFrame: accepts string and Uint8Array payload', () => {
  const fromStr = encodeFrame(MsgType.STDOUT, 1n, 'abc');
  assert.equal(fromStr.subarray(HEADER_LEN).toString('utf8'), 'abc');

  const fromUint = encodeFrame(MsgType.STDOUT, 1n, new Uint8Array([1, 2, 3]));
  assert.deepEqual(Array.from(fromUint.subarray(HEADER_LEN)), [1, 2, 3]);
});

test('FrameDecoder: single complete frame', () => {
  const dec = new FrameDecoder();
  const payload = Buffer.from('test', 'utf8');
  const frames = dec.feed(encodeFrame(MsgType.STDOUT, 7n, payload));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].msgType, MsgType.STDOUT);
  assert.equal(frames[0].paneId, 7n);
  assert.deepEqual(frames[0].payload, payload);
});

test('FrameDecoder: multiple frames in one chunk', () => {
  const dec = new FrameDecoder();
  const a = encodeFrame(MsgType.STDOUT, 1n, Buffer.from('aaa'));
  const b = encodeFrame(MsgType.STDOUT, 2n, Buffer.from('bbbb'));
  const c = encodeFrame(MsgType.PING, 0n);
  const frames = dec.feed(Buffer.concat([a, b, c]));
  assert.equal(frames.length, 3);
  assert.equal(frames[0].paneId, 1n);
  assert.equal(frames[1].paneId, 2n);
  assert.equal(frames[2].msgType, MsgType.PING);
});

test('FrameDecoder: split frame across chunks', () => {
  const dec = new FrameDecoder();
  const full = encodeFrame(MsgType.STDOUT, 5n, Buffer.from('hello world'));
  // Header'ı ortadan böl
  const part1 = full.subarray(0, 8);
  const part2 = full.subarray(8, 14);
  const part3 = full.subarray(14);
  assert.equal(dec.feed(part1).length, 0);
  assert.equal(dec.feed(part2).length, 0);
  const frames = dec.feed(part3);
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].payload, Buffer.from('hello world'));
});

test('FrameDecoder: byte-by-byte streaming', () => {
  const dec = new FrameDecoder();
  const full = encodeFrame(MsgType.STDOUT, 9n, Buffer.from('streaming'));
  let collected = [];
  for (const byte of full) {
    collected = collected.concat(dec.feed(Buffer.from([byte])));
  }
  assert.equal(collected.length, 1);
  assert.equal(collected[0].paneId, 9n);
  assert.equal(collected[0].payload.toString('utf8'), 'streaming');
});

test('FrameDecoder: rejects oversized frame in stream', () => {
  const dec = new FrameDecoder();
  const bad = Buffer.alloc(HEADER_LEN);
  bad.writeUInt32BE(MAX_PAYLOAD + 1, 0);
  bad.writeUInt8(MsgType.STDOUT, 4);
  bad.writeBigUInt64BE(0n, 5);
  assert.throws(() => dec.feed(bad), /payload too large/);
  // Decoder zehirlenmemeli: buffer sıfırlanır, sonraki geçerli frame işlenir.
  assert.equal(dec.pending, 0);
  const frames = dec.feed(encodeFrame(MsgType.PING, 0n));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].msgType, MsgType.PING);
});

test('FrameDecoder: skips unknown msg type and keeps stream in sync', () => {
  const unknown = [];
  const dec = new FrameDecoder({ onUnknown: (t, id) => unknown.push([t, id]) });
  const bad = Buffer.alloc(HEADER_LEN + 3);
  bad.writeUInt32BE(3, 0);
  bad.writeUInt8(0xFF, 4);
  bad.writeBigUInt64BE(9n, 5);
  const good = encodeFrame(MsgType.STDOUT, 1n, Buffer.from('ok'));
  const frames = dec.feed(Buffer.concat([bad, good]));
  assert.deepEqual(unknown, [[0xFF, 9n]]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.toString('utf8'), 'ok');
});

test('FrameDecoder: large frame fed in many chunks is reassembled once', () => {
  const dec = new FrameDecoder();
  const payload = Buffer.alloc(256 * 1024, 0x61);
  const full = encodeFrame(MsgType.STDOUT, 3n, payload);
  let frames = [];
  for (let i = 0; i < full.length; i += 1000) {
    frames = frames.concat(dec.feed(full.subarray(i, i + 1000)));
  }
  assert.equal(frames.length, 1);
  assert.equal(frames[0].payload.length, payload.length);
  assert.equal(dec.pending, 0);
});

test('FrameDecoder: binary safe — null bytes and high bits', () => {
  const dec = new FrameDecoder();
  const payload = Buffer.from([0x00, 0xFF, 0x1B, 0x5B, 0x33, 0x31, 0x6D, 0xF0, 0x9F, 0x9A, 0x80]);
  const frames = dec.feed(encodeFrame(MsgType.STDOUT, 1n, payload));
  assert.equal(frames.length, 1);
  assert.deepEqual(frames[0].payload, payload);
});

test('FrameDecoder: payload ownership — independent of internal buffer', () => {
  const dec = new FrameDecoder();
  const a = encodeFrame(MsgType.STDOUT, 1n, Buffer.from('first'));
  const b = encodeFrame(MsgType.STDOUT, 2n, Buffer.from('second'));
  const frames = dec.feed(Buffer.concat([a, b]));
  // Payload kopyası bağımsız olmalı — decoder buffer'ı taşıdığında değişmemeli
  const firstPayload = frames[0].payload;
  dec.feed(encodeFrame(MsgType.STDOUT, 99n, Buffer.from('xxxxxxxx')));
  assert.equal(firstPayload.toString('utf8'), 'first');
});

// --- Dispatch / PtyManager ------------------------------------------------

function fakePty({ failSpawn = false } = {}) {
  const procs = [];
  return {
    procs,
    spawn(shell, args, opts) {
      if (failSpawn) throw new Error('File not found: ' + shell);
      const p = {
        shell, args, opts, paused: false, killed: false, written: [],
        _onData: null, _onExit: null,
        onData(cb) { this._onData = cb; },
        onExit(cb) { this._onExit = cb; },
        write(d) { this.written.push(d); },
        resize() {},
        kill() { this.killed = true; },
        pause() { this.paused = true; },
        resume() { this.paused = false; },
      };
      procs.push(p);
      return p;
    },
  };
}

function harness(ptyImpl) {
  const sent = [];
  const writeFrame = (msgType, paneId, payload) => {
    sent.push({ msgType, paneId, payload });
    return true;
  };
  const manager = new PtyManager({ writeFrame, log: () => {}, ptyImpl });
  return { sent, writeFrame, manager };
}

const spawnFrame = (id) => ({
  msgType: MsgType.SPAWN,
  paneId: id,
  payload: encodePayload({ shell: 'cmd.exe', args: [], cols: 80, rows: 24 }),
});

test('dispatch: spawn failure reports ERROR + EXIT for the real pane id', () => {
  const { sent, writeFrame, manager } = harness(fakePty({ failSpawn: true }));
  dispatch(spawnFrame(5n), manager, writeFrame, () => {});
  assert.equal(sent.length, 2);
  assert.equal(sent[0].msgType, MsgType.ERROR);
  assert.equal(sent[0].paneId, 5n);
  assert.equal(decodePayload(sent[0].payload).code, 'spawn_failed');
  assert.equal(sent[1].msgType, MsgType.EXIT);
  assert.equal(sent[1].paneId, 5n);
});

test('dispatch: an error does not stop later frames from being handled', () => {
  const fp = fakePty();
  const { sent, writeFrame, manager } = harness(fp);
  const bad = { msgType: MsgType.RESIZE, paneId: 1n, payload: Buffer.from([0xff, 0xff, 0x00]) };
  dispatch(bad, manager, writeFrame, () => {});
  dispatch(spawnFrame(2n), manager, writeFrame, () => {});
  assert.equal(sent[0].msgType, MsgType.ERROR);
  assert.equal(manager.size(), 1);
});

test('dispatch: duplicate spawn reports ERROR but no EXIT (pane still alive)', () => {
  const { sent, writeFrame, manager } = harness(fakePty());
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].msgType, MsgType.ERROR);
  assert.equal(manager.size(), 1);
});

test('PtyManager: credit mode pauses a flooding pane and resumes after ack', () => {
  const fp = fakePty();
  const { writeFrame, manager } = harness(fp);
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  dispatch({ msgType: MsgType.FLOW_RESUME, paneId: 0n, payload: Buffer.alloc(0) }, manager, writeFrame, () => {});
  const p = fp.procs[0];
  p._onData('x'.repeat(FLOW_HIGH_WATER));
  assert.equal(p.paused, true);
  const ack = encodePayload({ bytes: FLOW_HIGH_WATER });
  dispatch({ msgType: MsgType.FLOW_RESUME, paneId: 1n, payload: ack }, manager, writeFrame, () => {});
  assert.equal(p.paused, false);
});

test('PtyManager: without credit mode output never pauses (old Tauri compat)', () => {
  const fp = fakePty();
  const { writeFrame, manager } = harness(fp);
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  fp.procs[0]._onData('x'.repeat(FLOW_HIGH_WATER * 2));
  assert.equal(fp.procs[0].paused, false);
});

test('PtyManager: drain wait pauses all panes until drained', () => {
  const fp = fakePty();
  const { writeFrame, manager } = harness(fp);
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  dispatch(spawnFrame(2n), manager, writeFrame, () => {});
  manager.setDrainWait(true);
  assert.ok(fp.procs.every((p) => p.paused));
  manager.setDrainWait(false);
  assert.ok(fp.procs.every((p) => !p.paused));
});

test('PtyManager: exit with numeric signal is encoded as string', () => {
  const fp = fakePty();
  const { sent, writeFrame, manager } = harness(fp);
  dispatch(spawnFrame(1n), manager, writeFrame, () => {});
  fp.procs[0]._onExit({ exitCode: 3, signal: 9 });
  const exit = sent.find((f) => f.msgType === MsgType.EXIT);
  assert.deepEqual(decodePayload(exit.payload), { exit_code: 3, signal: '9' });
  assert.equal(manager.size(), 0);
});

test('sanitizeEnv strips internal sidecar variables', () => {
  const env = sanitizeEnv({ PATH: 'x', PKG_EXECPATH: 'y', TAURI_FOO: 'z', Pkg_Other: 'w', HOME: 'h' });
  assert.deepEqual(env, { PATH: 'x', HOME: 'h' });
});

test('spawn env does not leak internal variables to the shell', () => {
  process.env.PKG_EXECPATH = 'secret';
  try {
    const fp = fakePty();
    const { writeFrame, manager } = harness(fp);
    dispatch(spawnFrame(1n), manager, writeFrame, () => {});
    assert.equal(fp.procs[0].opts.env.PKG_EXECPATH, undefined);
  } finally {
    delete process.env.PKG_EXECPATH;
  }
});
