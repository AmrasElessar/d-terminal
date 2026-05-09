// aiPricing — token tahmini, cost hesaplama, formatlama yardımcıları.
// UI'da "≈ 1.2k tok · ≈ $0.008" rozeti üreten fonksiyonların regression testi.

import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  estimateCost,
  formatUsageBadge,
  sumUsage,
  type UsageEstimate,
} from './aiPricing';

describe('estimateTokens', () => {
  it('boş string → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('ASCII 4 karakter → 1 token (4 char/token kuralı)', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('ASCII 8 karakter → 2 token', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('1 karakter → minimum 1 token (Math.max guard)', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('multibyte unicode (Türkçe) — JS string length bazlı sayım', () => {
    // 'ışık' = 4 char (her biri JS string length 1) → 1 token
    expect(estimateTokens('ışık')).toBe(1);
    // 'merhaba dünya' = 13 char → ceil(13/4) = 4
    expect(estimateTokens('merhaba dünya')).toBe(4);
  });
});

describe('estimateCost', () => {
  it('bilinen model (claude-opus-4-7) → costUsd hesaplanır', () => {
    // 4 char input + 4 char output = 1+1 token; opus = $15 / $75 per 1M
    const r = estimateCost('anthropic', 'claude-opus-4-7', 'abcd', 'efgh');
    expect(r.inputTokens).toBe(1);
    expect(r.outputTokens).toBe(1);
    expect(r.costUsd).not.toBeNull();
    // 1/1M * 15 + 1/1M * 75 = 0.00009
    expect(r.costUsd).toBeCloseTo(15e-6 + 75e-6, 12);
  });

  it('bilinmeyen model → costUsd null', () => {
    const r = estimateCost('anthropic', 'opus-99-future', 'abcd', 'efgh');
    expect(r.costUsd).toBeNull();
    expect(r.inputTokens).toBe(1);
    expect(r.outputTokens).toBe(1);
  });

  it('ollama provider → cost 0 (yerel)', () => {
    const r = estimateCost('ollama', 'llama3', 'merhaba', 'cevap');
    expect(r.costUsd).toBe(0);
  });

  it('ollama/ prefix\'li model id → cost 0', () => {
    const r = estimateCost('custom', 'ollama/llama3', 'a', 'b');
    expect(r.costUsd).toBe(0);
  });
});

describe('sumUsage', () => {
  it('boş array → tüm değerler 0', () => {
    const r = sumUsage([]);
    expect(r.inputTokens).toBe(0);
    expect(r.outputTokens).toBe(0);
    expect(r.costUsd).toBe(0);
  });

  it('çoklu giriş — token ve cost toplanır', () => {
    const items: UsageEstimate[] = [
      { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
      { inputTokens: 5, outputTokens: 15, costUsd: 0.002 },
    ];
    const r = sumUsage(items);
    expect(r.inputTokens).toBe(15);
    expect(r.outputTokens).toBe(35);
    expect(r.costUsd).toBeCloseTo(0.003, 10);
  });

  it('listede null cost varsa toplam null olur', () => {
    const items: UsageEstimate[] = [
      { inputTokens: 10, outputTokens: 20, costUsd: 0.001 },
      { inputTokens: 5, outputTokens: 15, costUsd: null },
    ];
    const r = sumUsage(items);
    expect(r.costUsd).toBeNull();
    // Token sayıları yine toplanır
    expect(r.inputTokens).toBe(15);
    expect(r.outputTokens).toBe(35);
  });
});

describe('formatUsageBadge', () => {
  it('1000\'den az token → "N tok" formatı', () => {
    const s = formatUsageBadge({ inputTokens: 100, outputTokens: 200, costUsd: null });
    expect(s).toBe('≈ 300 tok');
  });

  it('1000+ token → "X.Yk tok" formatı', () => {
    const s = formatUsageBadge({ inputTokens: 600, outputTokens: 600, costUsd: null });
    expect(s).toContain('1.2k tok');
  });

  it('cost 0 → "yerel" etiketi', () => {
    const s = formatUsageBadge({ inputTokens: 50, outputTokens: 50, costUsd: 0 });
    expect(s).toBe('100 tok · yerel');
  });

  it('cost <0.001 → "<$0.001" gösterimi', () => {
    const s = formatUsageBadge({ inputTokens: 1, outputTokens: 1, costUsd: 0.0001 });
    expect(s).toContain('<$0.001');
  });

  it('cost 0.001-1 arası → 4 ondalık format', () => {
    const s = formatUsageBadge({ inputTokens: 100, outputTokens: 100, costUsd: 0.0123 });
    expect(s).toContain('$0.0123');
  });

  it('cost ≥1 → 2 ondalık format', () => {
    const s = formatUsageBadge({ inputTokens: 100, outputTokens: 100, costUsd: 12.3456 });
    expect(s).toContain('$12.35');
  });
});
