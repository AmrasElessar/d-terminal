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
  encodeFrame,
  FrameDecoder,
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
});

test('FrameDecoder: rejects unknown msg type in stream', () => {
  const dec = new FrameDecoder();
  const bad = Buffer.alloc(HEADER_LEN);
  bad.writeUInt32BE(0, 0);
  bad.writeUInt8(0xFF, 4);
  bad.writeBigUInt64BE(0n, 5);
  assert.throws(() => dec.feed(bad), /unknown msg type/);
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
