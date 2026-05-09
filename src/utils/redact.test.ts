// AI'a gönderilmeden önce çalışan secret redaction modülü için smoke test.
// Test coverage audit'i (P0): bu fonksiyon olmadan kullanıcı API key'i AI'a
// sızabilir; pattern'lerin çalıştığını doğrulamak release-blocker.

import { describe, it, expect } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('boş input boş döndürür, redactedLines=0', () => {
    const r = redact('');
    expect(r.text).toBe('');
    expect(r.redactedLines).toBe(0);
  });

  it('OpenAI/Anthropic sk- key tespit edilir', () => {
    const r = redact('Bearer sk-abcdef1234567890ABCDEFGHIJ');
    expect(r.text).toContain('[REDACTED]');
    expect(r.text).not.toContain('sk-abcdef');
    expect(r.redactedLines).toBe(1);
  });

  it('GitHub PAT (ghp_) tespit edilir', () => {
    const r = redact('GH_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(r.text).toContain('[REDACTED]');
    expect(r.redactedLines).toBe(1);
  });

  it('AWS access key (AKIA…) tespit edilir', () => {
    const r = redact('export AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF');
    expect(r.text).toContain('[REDACTED]');
    expect(r.redactedLines).toBe(1);
  });

  it('Slack token (xoxb-…) tespit edilir', () => {
    const r = redact('SLACK=xoxb-1234567890-abcdefghij');
    expect(r.text).toContain('[REDACTED]');
  });

  it('password/token/secret kvp pattern tespit edilir', () => {
    const r = redact('password: hunter2\ntoken=foo123bar\napi_key="abc123"');
    expect(r.redactedLines).toBe(3);
  });

  it('Türkçe metinde uzun base64-benzeri Türkçe ifade false-positive olmamalı (best-effort)', () => {
    // Bu pattern (40+ char base64) gerçek base64 olmayan Türkçe metinde
    // tetiklenmez çünkü Türkçe karakterler [A-Za-z0-9+/=] dışında.
    const r = redact('Bu cümle uzun ama Türkçe karakter içerdiği için redact edilmez ışık');
    expect(r.redactedLines).toBe(0);
  });

  it('birden fazla satırda toplam redactedLines doğru sayılır', () => {
    const r = redact([
      'normal satır',
      'sk-abcdefghijklmnopqrstuvwxyz123',
      'token=secret123abc',
      'başka normal satır',
    ].join('\n'));
    expect(r.redactedLines).toBe(2);
  });

  it('custom pattern desteği', () => {
    const r = redact('CUSTOM_TOKEN=mysecret', [/CUSTOM_TOKEN=\S+/g]);
    expect(r.text).toContain('[REDACTED]');
    expect(r.redactedLines).toBe(1);
  });

  it('redact yalnızca eşleşen alanı değiştirir, satır geri kalan içeriği korunur', () => {
    const r = redact('Önce sk-1234567890ABCDEFGHIJabc sonra normal');
    expect(r.text).toContain('Önce ');
    expect(r.text).toContain(' sonra normal');
    expect(r.text).toContain('[REDACTED]');
  });
});
