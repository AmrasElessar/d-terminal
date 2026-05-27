// useModals — global tek modal state, single-modal kuralı.

import { beforeEach, describe, expect, it } from 'vitest';
import { useModals } from './useModals';

describe('useModals', () => {
  beforeEach(() => {
    // State module-level reactive; her test öncesi temizlemek için closeAll
    useModals().closeAll();
  });

  it('Başlangıçta tüm modal flag false', () => {
    const m = useModals();
    expect(m.state.newPane).toBe(false);
    expect(m.state.settings).toBe(false);
    expect(m.state.history).toBe(false);
    expect(m.state.snippets).toBe(false);
    expect(m.state.commandPalette).toBe(false);
    expect(m.state.about).toBe(false);
    expect(m.state.aiSuggest).toBe(false);
    expect(m.state.session.open).toBe(false);
  });

  it('open(kind) ilgili flag true yapar', () => {
    const m = useModals();
    m.open('settings');
    expect(m.state.settings).toBe(true);
    expect(m.state.newPane).toBe(false);
  });

  it('open yeni modal açarken eskileri kapatır (single-modal kuralı)', () => {
    const m = useModals();
    m.open('history');
    expect(m.state.history).toBe(true);
    m.open('settings');
    expect(m.state.settings).toBe(true);
    expect(m.state.history).toBe(false);
  });

  it('close(kind) sadece o modal kapatır', () => {
    const m = useModals();
    m.open('about');
    m.close('about');
    expect(m.state.about).toBe(false);
  });

  it('openSession save/load modunu set eder ve diğer modallar kapanır', () => {
    const m = useModals();
    m.open('settings');
    m.openSession('load');
    expect(m.state.session.open).toBe(true);
    expect(m.state.session.mode).toBe('load');
    expect(m.state.settings).toBe(false);
  });

  it('closeSession session kapatır ama mode korunur', () => {
    const m = useModals();
    m.openSession('save');
    m.closeSession();
    expect(m.state.session.open).toBe(false);
    expect(m.state.session.mode).toBe('save');
  });

  it('closeAll tüm modal flag false yapar', () => {
    const m = useModals();
    m.open('snippets');
    m.openSession('save');
    m.closeAll();
    expect(m.state.snippets).toBe(false);
    expect(m.state.session.open).toBe(false);
  });

  it('Aynı useModals() çağrısı state referansı paylaşır', () => {
    const m1 = useModals();
    const m2 = useModals();
    m1.open('aiSuggest');
    expect(m2.state.aiSuggest).toBe(true);
  });
});
