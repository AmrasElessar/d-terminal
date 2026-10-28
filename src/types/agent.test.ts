// parseAgentEvent — OSC 9999 şema doğrulaması (güvenilmez terminal çıktısı).

import { describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { agentEffectiveCost, parseAgentEvent } from './agent';
import { MAX_AGENTS_PER_PANE, useAgentWatchStore } from '@/stores/agentWatch';

describe('parseAgentEvent', () => {
  it('geçerli event tiplerini kabul eder', () => {
    expect(parseAgentEvent('{"k":"start","id":"a","name":"x"}')).toEqual({
      k: 'start',
      id: 'a',
      name: 'x',
      parent: undefined,
    });
    expect(parseAgentEvent('{"k":"progress","id":"a","msg":"hi"}')).toEqual({ k: 'progress', id: 'a', msg: 'hi' });
    expect(parseAgentEvent('{"k":"end","id":"a","status":"ok"}')?.k).toBe('end');
    expect(parseAgentEvent('{"k":"tokens","id":"a","in":1,"out":2}')?.k).toBe('tokens');
  });

  it('yanlış alan tipleri reddedilir (TypeError yerine null)', () => {
    expect(parseAgentEvent('{"k":"progress","id":"a","msg":5}')).toBeNull();
    expect(parseAgentEvent('{"k":"thinking","id":"a","text":{}}')).toBeNull();
    expect(parseAgentEvent('{"k":"start","id":"a","name":[1]}')).toBeNull();
    expect(parseAgentEvent('{"k":"tokens","id":"a","in":"9"}')).toBeNull();
    expect(parseAgentEvent('{"k":"tokens","id":"a","in":-1}')).toBeNull();
    expect(parseAgentEvent('{"k":"end","id":"a","status":"weird"}')).toBeNull();
    expect(parseAgentEvent('{"k":"await","id":"a","prompt":3}')).toBeNull();
  });

  it('bozuk / dizi / boş id / aşırı uzun payload reddedilir', () => {
    expect(parseAgentEvent('not json')).toBeNull();
    expect(parseAgentEvent('[1,2]')).toBeNull();
    expect(parseAgentEvent('{"k":"start","id":""}')).toBeNull();
    expect(parseAgentEvent(`{"k":"start","id":"${'x'.repeat(200)}"}`)).toBeNull();
    expect(parseAgentEvent('{"k":"progress","id":"a","msg":"' + 'x'.repeat(70 * 1024) + '"}')).toBeNull();
  });
});

describe('agentEffectiveCost', () => {
  const price = { inputPer1M: 1, outputPer1M: 2 };
  it('explicit cost öncelikli', () => {
    expect(agentEffectiveCost({ costUsd: 0.5, inputTokens: 10, outputTokens: 10 }, price)).toBe(0.5);
  });
  it('token × fiyat; fiyat yoksa null', () => {
    expect(agentEffectiveCost({ costUsd: 0, inputTokens: 1_000_000, outputTokens: 1_000_000 }, price)).toBe(3);
    expect(agentEffectiveCost({ costUsd: 0, inputTokens: 1, outputTokens: 0 }, undefined)).toBeNull();
  });
});

describe('agentWatch pane başına agent sınırı', () => {
  it('benzersiz start akışı MAX_AGENTS_PER_PANE ile sınırlanır', () => {
    setActivePinia(createPinia());
    const store = useAgentWatchStore();
    for (let i = 0; i < MAX_AGENTS_PER_PANE + 20; i++) {
      store.dispatch('p', { k: 'start', id: `a${i}`, name: 'n' });
      store.dispatch('p', { k: 'end', id: `a${i}`, status: 'ok' });
    }
    expect(store.paneView('p').value.agents.length).toBe(MAX_AGENTS_PER_PANE);
    // En yeniler korunur
    expect(store.paneView('p').value.agents[0]?.id).toBe(`a${MAX_AGENTS_PER_PANE + 19}`);
  });
});
