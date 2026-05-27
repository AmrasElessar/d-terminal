// MigrationDialog — legacy install migration modal component testi.
//
// Strateji: api.migrateRun / api.migrateDismiss mock'lanır (Tauri invoke'a
// gitmesin). Props ile DetectedLegacy fixture verilir; phase transitions
// (idle → running → success/failure), buton state'leri, emit event'leri ve
// ESC running fazında yutulması doğrulanır.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { mount, type VueWrapper } from '@vue/test-utils';
import MigrationDialog from './MigrationDialog.vue';
import type { DetectedLegacy, MigrationReport } from '@/api/tauri';

const migrateRunMock = vi.fn();
const migrateDismissMock = vi.fn();
vi.mock('@/api/tauri', () => ({
  api: {
    migrateRun: () => migrateRunMock(),
    migrateDismiss: () => migrateDismissMock(),
  },
}));

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      migration: {
        title: 'Legacy install detected',
        subtitle: 'Migrate your data?',
        detectedFrom: 'Found at: {path}',
        dbSize: 'Size: {size}',
        hasThemes: 'Custom themes included',
        hasConfig: 'Config file included',
        privacy: 'Stays on this PC.',
        migrate: 'Migrate',
        dismiss: 'Skip',
        cancel: 'Cancel',
        progress: 'Migrating…',
        successTitle: 'Migration complete',
        successBody: '{bytes} transferred.',
        successHint: 'Restart hint.',
        failureTitle: 'Migration failed',
        failureBody: 'Error: {error}',
        failureRetry: 'Try again',
        close: 'Close',
        restartToastMsg: '',
        restartToastAction: '',
      },
    },
  },
});

const detected: DetectedLegacy = {
  path: '…\\AppData\\Roaming\\D-Terminal',
  db_size_bytes: 1024 * 1024 * 5,
  has_themes: true,
  has_config: true,
};

const wrappers: VueWrapper[] = [];

function mountDialog(props: { open: boolean; detected: DetectedLegacy }): VueWrapper {
  const w = mount(MigrationDialog, {
    props,
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

describe('MigrationDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    migrateRunMock.mockReset();
    migrateDismissMock.mockReset();
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

  it('open=false → modal render edilmez', () => {
    const w = mountDialog({ open: false, detected });
    expect(w.find('dialog').exists()).toBe(false);
  });

  it('open=true → idle phase detect bilgisi render edilir', async () => {
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    expect(w.text()).toContain('Legacy install detected');
    expect(w.text()).toContain('Migrate your data?');
    expect(w.text()).toContain('…\\AppData\\Roaming\\D-Terminal');
    expect(w.text()).toContain('5.0 MB'); // formatBytes(5 MiB) → "5.0 MB"
    expect(w.text()).toContain('Custom themes included');
    expect(w.text()).toContain('Config file included');
  });

  it('has_themes=false → tema satırı görünmez', async () => {
    const w = mountDialog({
      open: true,
      detected: { ...detected, has_themes: false, has_config: false },
    });
    await flushTwoTicks();
    expect(w.text()).not.toContain('Custom themes included');
    expect(w.text()).not.toContain('Config file included');
  });

  it('Migrate buton tıklaması → api.migrateRun çağrılır, success ekranı görünür', async () => {
    const report: MigrationReport = {
      db_copied: true,
      themes_copied: 3,
      config_copied: true,
      total_bytes: 1024 * 1024 * 6,
    };
    migrateRunMock.mockResolvedValueOnce(report);
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const migrateBtn = w.findAll('button').find((b) => b.text() === 'Migrate')!;
    await migrateBtn.trigger('click');
    // mock resolve sonrası phase=success render
    await flushTwoTicks();
    await flushTwoTicks();
    expect(migrateRunMock).toHaveBeenCalledTimes(1);
    expect(w.text()).toContain('Migration complete');
    expect(w.text()).toContain('6.0 MB');
    expect(w.text()).toContain('Restart hint.');
    // migrated event emit edildi
    const emitted = w.emitted('migrated');
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([report]);
  });

  it('Migrate başarısız → failure ekranı + error mesajı', async () => {
    migrateRunMock.mockRejectedValueOnce({ kind: 'invalid_arg', message: 'paths equal' });
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const migrateBtn = w.findAll('button').find((b) => b.text() === 'Migrate')!;
    await migrateBtn.trigger('click');
    await flushTwoTicks();
    await flushTwoTicks();
    expect(w.text()).toContain('Migration failed');
    expect(w.text()).toContain('paths equal');
    expect(w.find('button').exists()).toBe(true); // retry + close butonları
  });

  it('Failure ekranında Retry → api.migrateRun tekrar çağrılır', async () => {
    migrateRunMock
      .mockRejectedValueOnce({ message: 'transient' })
      .mockResolvedValueOnce({
        db_copied: true,
        themes_copied: 0,
        config_copied: false,
        total_bytes: 1024,
      });
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Migrate')!
      .trigger('click');
    await flushTwoTicks();
    await flushTwoTicks();
    expect(w.text()).toContain('Migration failed');
    const retry = w.findAll('button').find((b) => b.text() === 'Try again')!;
    await retry.trigger('click');
    await flushTwoTicks();
    await flushTwoTicks();
    expect(migrateRunMock).toHaveBeenCalledTimes(2);
    expect(w.text()).toContain('Migration complete');
  });

  it('Skip butonu → api.migrateDismiss + dismissed/close emit', async () => {
    migrateDismissMock.mockResolvedValueOnce(undefined);
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const skip = w.findAll('button').find((b) => b.text() === 'Skip')!;
    await skip.trigger('click');
    await flushTwoTicks();
    expect(migrateDismissMock).toHaveBeenCalledTimes(1);
    expect(w.emitted('dismissed')).toBeTruthy();
    expect(w.emitted('close')).toBeTruthy();
  });

  it('migrateDismiss reddetse bile dismissed/close emit edilir (UI bloklanmaz)', async () => {
    migrateDismissMock.mockRejectedValueOnce(new Error('write failed'));
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const skip = w.findAll('button').find((b) => b.text() === 'Skip')!;
    await skip.trigger('click');
    await flushTwoTicks();
    expect(w.emitted('dismissed')).toBeTruthy();
  });

  it('running fazında Migrate + Skip butonları disabled olur', async () => {
    // migrateRun async, hiç resolve etmeyecek → forever running
    migrateRunMock.mockReturnValueOnce(new Promise(() => {}));
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const migrateBtn = w.findAll('button').find((b) => b.text() === 'Migrate')!;
    await migrateBtn.trigger('click');
    await flushTwoTicks();
    const skip = w.findAll('button').find((b) => b.text() === 'Skip')!;
    expect((migrateBtn.element as HTMLButtonElement).disabled).toBe(true);
    expect((skip.element as HTMLButtonElement).disabled).toBe(true);
    expect(w.text()).toContain('Migrating…');
  });

  it('ESC running fazında yutulur (kapanmaz)', async () => {
    migrateRunMock.mockReturnValueOnce(new Promise(() => {}));
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    await w
      .findAll('button')
      .find((b) => b.text() === 'Migrate')!
      .trigger('click');
    await flushTwoTicks();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushTwoTicks();
    // close emit edilmemeli — running'de ESC yutuldu
    expect(w.emitted('close')).toBeFalsy();
  });

  it('ESC idle fazda close emit eder', async () => {
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushTwoTicks();
    expect(w.emitted('close')).toBeTruthy();
  });

  it('aria-modal + alertdialog + describedby attributeleri var', async () => {
    const w = mountDialog({ open: true, detected });
    await flushTwoTicks();
    const panel = w.find('article');
    expect(panel.attributes('role')).toBe('alertdialog');
    expect(panel.attributes('aria-modal')).toBe('true');
    expect(panel.attributes('aria-labelledby')).toBe('mig-title');
    expect(panel.attributes('aria-describedby')).toBe('mig-desc');
  });
});
