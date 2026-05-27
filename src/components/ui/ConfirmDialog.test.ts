// ConfirmDialog — global onay modalı için component test'i.
//
// Strateji: gerçek Pinia + gerçek store + minimal i18n stub. confirmAsk
// üzerinden değil, store.request() ile request push edilir; ConfirmDialog
// pending'i izleyip render eder. Click + keyboard + danger flag + custom
// label davranışları assert edilir.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useConfirmStore } from '@/stores/confirm';
import ConfirmDialog from './ConfirmDialog.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      common: {
        confirm: 'Confirm',
        cancel: 'Cancel',
        confirmTitle: 'Are you sure?',
      },
    },
  },
});

const wrappers: VueWrapper[] = [];

function mountDialog(): VueWrapper {
  const w = mount(ConfirmDialog, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  wrappers.push(w);
  return w;
}

async function flushTwoTicks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('ConfirmDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
  });

  afterEach(() => {
    while (wrappers.length > 0) {
      const w = wrappers.pop();
      try {
        w?.unmount();
      } catch {
        /* swallow */
      }
    }
    document.body.innerHTML = '';
  });

  it('pending yokken modal render edilmez', async () => {
    const w = mountDialog();
    expect(w.find('dialog').exists()).toBe(false);
  });

  it('store.request çağrılınca modal mount edilir, mesaj görünür', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('Bu paneli kapatayım mı?');
    await flushTwoTicks();
    expect(w.find('dialog').exists()).toBe(true);
    expect(w.text()).toContain('Bu paneli kapatayım mı?');
    expect(w.text()).toContain('Are you sure?');
  });

  it('Confirm butonu → store.resolve(true) → Promise true ile çözülür', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    const p = store.request('Onayla?');
    await flushTwoTicks();
    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Confirm')!;
    expect(confirmBtn).toBeDefined();
    await confirmBtn.trigger('click');
    await expect(p).resolves.toBe(true);
    expect(w.find('dialog').exists()).toBe(false);
  });

  it('Cancel butonu → Promise false ile çözülür', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    const p = store.request('İptal?');
    await flushTwoTicks();
    const cancelBtn = w.findAll('button').find((b) => b.text() === 'Cancel')!;
    await cancelBtn.trigger('click');
    await expect(p).resolves.toBe(false);
  });

  it('Overlay click.self → cancel (Promise false)', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    const p = store.request('Overlay test?');
    await flushTwoTicks();
    // dialog element kendisi tıklanırsa (panel değil) cancel — @click.self
    await w.find('dialog').trigger('click');
    await expect(p).resolves.toBe(false);
  });

  it('ESC tuşu → cancel', async () => {
    mountDialog();
    const store = useConfirmStore();
    const p = store.request('ESC?');
    await flushTwoTicks();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('Enter tuşu → confirm (active cancel değilken)', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    const p = store.request('Enter?');
    await flushTwoTicks();
    // Cancel başlangıçta focus alır; manuel olarak confirm butonuna focus ver
    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Confirm')!;
    (confirmBtn.element as HTMLButtonElement).focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p).resolves.toBe(true);
  });

  it('Enter tuşu active cancel iken → cancel (yıkıcı varsayım yok)', async () => {
    mountDialog();
    const store = useConfirmStore();
    const p = store.request('Yıkıcı?', { danger: true });
    await flushTwoTicks();
    // useFocusTrap default'u cancel'a focus verir → Enter cancel olmalı
    expect(document.activeElement?.textContent).toBe('Cancel');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await expect(p).resolves.toBe(false);
  });

  it('danger:true → onay butonu .danger class\'ı alır', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('Silmek istiyor musun?', { danger: true });
    await flushTwoTicks();
    const confirmBtn = w.findAll('button').find((b) => b.text() === 'Confirm')!;
    expect(confirmBtn.classes()).toContain('danger');
  });

  it('custom confirmLabel + cancelLabel → o metinler görünür', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('Reset?', { confirmLabel: 'Sıfırla', cancelLabel: 'Vazgeç' });
    await flushTwoTicks();
    const labels = w.findAll('button').map((b) => b.text());
    expect(labels).toContain('Sıfırla');
    expect(labels).toContain('Vazgeç');
  });

  it('kind=error → header kind-error class\'ı taşır', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('Bağlantı koptu', { kind: 'error' });
    await flushTwoTicks();
    expect(w.find('header.kind-error').exists()).toBe(true);
  });

  it('custom title verilirse görünür, yoksa fallback i18n', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('Test', { title: 'Özel Başlık' });
    await flushTwoTicks();
    expect(w.text()).toContain('Özel Başlık');
    expect(w.text()).not.toContain('Are you sure?');
  });

  it('aria-modal=true ve role=alertdialog mevcut', async () => {
    const w = mountDialog();
    const store = useConfirmStore();
    void store.request('a11y');
    await flushTwoTicks();
    const panel = w.find('article');
    expect(panel.attributes('role')).toBe('alertdialog');
    expect(panel.attributes('aria-modal')).toBe('true');
    expect(panel.attributes('aria-labelledby')).toBe('confirm-title');
    expect(panel.attributes('aria-describedby')).toBe('confirm-msg');
  });
});
