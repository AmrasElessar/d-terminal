// useChatsStore — Pane lifecycle bağımsız chat history store.
// Pinia setup-store; component remount'tan etkilenmemesi kritik (audit K-5).

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useChatsStore } from './chats';
import type { ChatMessage } from '@/types/ai';

describe('useChatsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('ensure aynı paneId için aynı ref döner (referans eşitliği)', () => {
    const s = useChatsStore();
    const a = s.ensure('pane-1');
    const b = s.ensure('pane-1');
    expect(a).toBe(b);
  });

  it('farklı paneId → ayrı ref instance', () => {
    const s = useChatsStore();
    const a = s.ensure('pane-1');
    const b = s.ensure('pane-2');
    expect(a).not.toBe(b);
    expect(a.value).toEqual([]);
    expect(b.value).toEqual([]);
  });

  it('mesajlar push edilir; ikinci ensure çağrısında veri korunur', () => {
    const s = useChatsStore();
    const ref1 = s.ensure('pane-1');
    const msg: ChatMessage = { role: 'user', content: 'merhaba' };
    ref1.value.push(msg);

    // Component "remount" simülasyonu — yeni ensure çağrısı
    const ref2 = s.ensure('pane-1');
    expect(ref2.value).toHaveLength(1);
    expect(ref2.value[0]?.content).toBe('merhaba');
  });

  it('clearPane ref\'i siler; sonraki ensure boş ref döner', () => {
    const s = useChatsStore();
    const ref1 = s.ensure('pane-1');
    ref1.value.push({ role: 'user', content: 'eski mesaj' });

    s.clearPane('pane-1');
    const ref2 = s.ensure('pane-1');
    expect(ref2.value).toEqual([]);
    // Eski ref artık aynı obje olmamalı
    expect(ref1).not.toBe(ref2);
  });

  it('clearPane çoklu pane izolasyonu — biri silindiğinde diğeri etkilenmez', () => {
    const s = useChatsStore();
    const a = s.ensure('pane-1');
    const b = s.ensure('pane-2');
    a.value.push({ role: 'user', content: 'A1' });
    b.value.push({ role: 'user', content: 'B1' });

    s.clearPane('pane-1');
    // pane-2 ref'i hâlâ değişmemiş ve veri ayakta
    const bAgain = s.ensure('pane-2');
    expect(bAgain).toBe(b);
    expect(bAgain.value).toHaveLength(1);
    expect(bAgain.value[0]?.content).toBe('B1');
  });

  it('clearPane bilinmeyen paneId → no-op (hata fırlatmaz)', () => {
    const s = useChatsStore();
    expect(() => s.clearPane('bilinmeyen')).not.toThrow();
  });

  it('aynı pane\'e arka arkaya çoklu push — tüm mesajlar sırayla durur', () => {
    const s = useChatsStore();
    const r = s.ensure('pane-1');
    r.value.push({ role: 'user', content: '1' });
    r.value.push({ role: 'assistant', content: '2' });
    r.value.push({ role: 'user', content: '3' });
    expect(r.value.map((m) => m.content)).toEqual(['1', '2', '3']);
  });

  it('store store-lokal kapsamda izole — yeni Pinia → boş state', () => {
    const s1 = useChatsStore();
    s1.ensure('pane-1').value.push({ role: 'user', content: 'eski' });

    // Yeni Pinia kurulumu
    setActivePinia(createPinia());
    const s2 = useChatsStore();
    expect(s2.ensure('pane-1').value).toEqual([]);
  });
});
