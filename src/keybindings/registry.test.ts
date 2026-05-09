// KeybindingRegistry — DOM seviyesinde tek dinleyici davranışını test eder.
// `comboOfEvent` private olduğu için integration tarzı: register + attach +
// dispatchEvent ile gerçek event flow doğrulanır.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeybindingRegistry } from './registry';
import { DEFAULT_SHORTCUTS } from './defaults';

function keydown(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
}

describe('KeybindingRegistry', () => {
  let reg: KeybindingRegistry;

  beforeEach(() => {
    reg = new KeybindingRegistry();
  });

  afterEach(() => {
    reg.detach();
  });

  it('setCombo çakışan combo → conflicting id döner', () => {
    // Ctrl+T zaten 'tab.new' tarafından alınmış; pane.new bunu istemeye kalkarsa
    // çakışma id'si dönmeli.
    const conflict = reg.setCombo('pane.new', 'Ctrl+T');
    expect(conflict).toBe('tab.new');
    // Kayıtlı default combo değişmemiş olmalı
    expect(reg.getCombo('pane.new')).toBe('Ctrl+Shift+T');
  });

  it('setCombo kendi id\'sine atama → null (no-op kabul)', () => {
    const r = reg.setCombo('tab.new', 'Ctrl+T');
    expect(r).toBeNull();
  });

  it('setCombo override yeni combo + eski combo serbestleşir', () => {
    // Default tablo'da olmayan bir combo seç (Ctrl+Alt+N dfetch.toggleNetExpand'da var).
    const fresh = 'Ctrl+Shift+Alt+J';
    const r = reg.setCombo('tab.new', fresh);
    expect(r).toBeNull();
    expect(reg.getCombo('tab.new')).toBe(fresh);
    // Eski combo serbest kalmalı: başka id artık Ctrl+T'yi alabilmeli
    const r2 = reg.setCombo('pane.new', 'Ctrl+T');
    expect(r2).toBeNull();
    expect(reg.getCombo('pane.new')).toBe('Ctrl+T');
  });

  it('Ctrl+Shift+K combo dispatch → handler tetiklenir (kayıtlıysa)', () => {
    // Önce mevcut bir id'ye Ctrl+Shift+K ata (default tabloda bu kombo yok)
    const r = reg.setCombo('history.search', 'Ctrl+Shift+K');
    expect(r).toBeNull();
    const handler = vi.fn();
    reg.register('history.search', handler);
    reg.attach();
    window.dispatchEvent(keydown({ key: 'k', ctrlKey: true, shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('plain Escape — herhangi bir handler tetiklemez', () => {
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    window.dispatchEvent(keydown({ key: 'Escape' }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('sadece modifier (Ctrl alone) → combo null, handler yok', () => {
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    // key='Control' → comboOfEvent null döndürür
    window.dispatchEvent(keydown({ key: 'Control', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('Türkçe AltGr (Ctrl+Alt) ile yazılan harf → false-positive olmamalı', () => {
    // TR-Q klavyede '@' = AltGr+Q → browser e.ctrlKey + e.altKey true verir.
    // 'Ctrl+Alt+Q' default tabloda yok, dolayısıyla handler tetiklenmemeli.
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    window.dispatchEvent(
      keydown({ key: '@', ctrlKey: true, altKey: true }),
    );
    // tab.new (Ctrl+T) tetiklenmemiş olmalı; çünkü combo Ctrl+Alt+@.
    expect(handler).not.toHaveBeenCalled();
  });

  it('attach idempotent — iki kez çağırınca tek listener kalır', () => {
    // history.search'ün default combo'su Ctrl+Shift+F → o testte default combo kullan
    const handler = vi.fn();
    reg.register('history.search', handler);
    reg.attach();
    reg.attach(); // ikinci çağrı no-op olmalı
    window.dispatchEvent(keydown({ key: 'F', ctrlKey: true, shiftKey: true }));
    // Listener bir kere bağlanmalı ki handler tek kez çalışsın (iki kez değil)
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('detach sonrası event tetiklenmez', () => {
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    reg.detach();
    window.dispatchEvent(keydown({ key: 't', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('unregister sonrası combo eşleşse de handler yok → çağrılmaz', () => {
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    reg.unregister('tab.new');
    window.dispatchEvent(keydown({ key: 't', ctrlKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('getAll default shortcut sayısını döndürür', () => {
    expect(reg.getAll().length).toBe(DEFAULT_SHORTCUTS.length);
  });

  it('Alt+F4 (default tabloda yok) — handler yok, no-op', () => {
    const handler = vi.fn();
    reg.register('tab.new', handler);
    reg.attach();
    window.dispatchEvent(keydown({ key: 'F4', altKey: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
