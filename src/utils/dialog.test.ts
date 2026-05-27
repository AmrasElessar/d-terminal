// confirmAsk — in-app ConfirmDialog wrapper'ı için test.
//
// Eski sürümde Tauri native dialog (Win32 TaskDialog) çağrılıyordu;
// şimdi Pinia confirm store'una request push edilir, kullanıcı action'ı
// resolve eder. Test: store interaction + Promise resolve davranışı.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useConfirmStore } from '@/stores/confirm';
import { confirmAsk } from './dialog';

describe('confirmAsk → ConfirmDialog store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('store.pending request ile dolar', async () => {
    const store = useConfirmStore();
    void confirmAsk('Devam edilsin mi?');
    // request synchronously pending oluşturur — promise pending state'te kalır.
    expect(store.pending).not.toBeNull();
    expect(store.pending?.message).toBe('Devam edilsin mi?');
  });

  it('store.resolve(true) → confirmAsk Promise true ile çözülür', async () => {
    const store = useConfirmStore();
    const p = confirmAsk('Kapat?');
    store.resolve(true);
    await expect(p).resolves.toBe(true);
    expect(store.pending).toBeNull();
  });

  it('store.resolve(false) → Promise false ile çözülür', async () => {
    const store = useConfirmStore();
    const p = confirmAsk('Sil?');
    store.resolve(false);
    await expect(p).resolves.toBe(false);
  });

  it('options (title + kind) pending request\'e iletilir', async () => {
    const store = useConfirmStore();
    void confirmAsk('Kapatılsın mı?', { title: 'Pane', kind: 'warning' });
    expect(store.pending?.options.title).toBe('Pane');
    expect(store.pending?.options.kind).toBe('warning');
  });

  it('danger flag pending request\'e iletilir', async () => {
    const store = useConfirmStore();
    void confirmAsk('Sil?', { danger: true });
    expect(store.pending?.options.danger).toBe(true);
  });

  it('options olmadan çağrı boş options object oluşturur', async () => {
    const store = useConfirmStore();
    void confirmAsk('Sade soru?');
    expect(store.pending?.options).toEqual({});
  });

  it('ardışık çağrı: ikinci request birinciyi false ile resolve eder', async () => {
    const store = useConfirmStore();
    const first = confirmAsk('İlk');
    void confirmAsk('İkinci');
    // İlk istek false'la sonlandırılmış olmalı (overlap engelleme).
    await expect(first).resolves.toBe(false);
    expect(store.pending?.message).toBe('İkinci');
  });

  it('resolve sonrası store.pending null olur', async () => {
    const store = useConfirmStore();
    const p = confirmAsk('Onay');
    expect(store.pending).not.toBeNull();
    store.resolve(true);
    await p;
    expect(store.pending).toBeNull();
  });
});
