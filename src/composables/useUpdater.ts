// Tauri 2 updater wrapper. 3 mod (notify / download-wait / auto), 24h debounce.
//
// Akış:
//   1. checkForUpdate() → tauri-plugin-updater.check()
//   2. Sürüm varsa updateMode'a göre dallan:
//      - notify: toast → [İndir & Yükle] [Sonra]
//      - download-wait: arka planda download() → bittiğinde toast [Yükle ve yeniden başlat] [Sonra]
//      - auto: download() + install() (uygulama yeniden başlar)
//
// Capabilities gerektirir: updater:default, process:default, process:allow-restart.
// Tauri.conf.json'da pubkey + endpoint doğru olmalı.

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useSettingsStore, type UpdateCheckFrequency } from '@/stores/settings';
import { useToastsStore } from '@/stores/toasts';
import { i18n } from '@/main';

const LAST_CHECK_KEY = 'updater.lastCheckAt';
const READY_UPDATE_KEY = 'updater.readyVersion';
/** Settings.updateCheckFrequency → milisaniye eşleme. `startup` = 0 (debounce yok,
 *  her açılışta check). Diğerleri lastCheckAt baz alır. */
const FREQUENCY_TO_MS: Record<UpdateCheckFrequency, number> = {
  startup: 0,
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

let cachedUpdate: Update | null = null;
let inProgress = false;

function tt(key: string, params?: Record<string, unknown>): string {
  // i18n global instance — composable Vue setup dışından da çağrılabilir
  return i18n.global.t(key, params ?? {}) as string;
}

function lastCheckAt(): number {
  const raw = localStorage.getItem(LAST_CHECK_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

function recordCheck() {
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
}

/** Manuel kontrol — settings ekranında "Şimdi kontrol et" butonu çağırır.
 *  `silent=false` → sürüm yoksa "Güncel" toast'ı gösterir. */
export async function checkForUpdate(silent = true): Promise<Update | null> {
  if (inProgress) return null;
  inProgress = true;
  const toasts = useToastsStore();
  const settings = useSettingsStore();
  try {
    const update = await check();
    recordCheck();
    if (!update) {
      if (!silent) toasts.success(tt('update.upToDate'));
      cachedUpdate = null;
      return null;
    }
    cachedUpdate = update;
    handleAvailable(update, settings.state.updateMode);
    return update;
  } catch (err) {
    console.warn('updater: check failed', err);
    if (!silent) toasts.error(tt('update.checkFailed'));
    return null;
  } finally {
    inProgress = false;
  }
}

function handleAvailable(update: Update, mode: 'off' | 'notify' | 'download-wait' | 'auto') {
  const toasts = useToastsStore();
  const version = update.version;
  if (mode === 'off') return;

  if (mode === 'notify') {
    toasts.info(tt('update.available', { version }), {
      duration: 0,
      actions: [
        {
          label: tt('update.installNow'),
          primary: true,
          handler: () => downloadAndInstall(update),
        },
        { label: tt('update.later'), handler: () => {} },
      ],
    });
    return;
  }

  if (mode === 'download-wait') {
    // Sessiz indir, sonra "kapatıp kur?" sor
    void downloadOnly(update).then((ok) => {
      if (!ok) return;
      toasts.success(tt('update.readyInstall', { version }), {
        duration: 0,
        actions: [
          {
            label: tt('update.installAndRestart'),
            primary: true,
            handler: () => installCached(update),
          },
          { label: tt('update.later'), handler: () => {} },
        ],
      });
    });
    return;
  }

  if (mode === 'auto') {
    void downloadAndInstall(update);
  }
}

async function downloadAndInstall(update: Update): Promise<boolean> {
  const toasts = useToastsStore();
  try {
    const progressId = toasts.info(tt('update.downloading', { version: update.version }), {
      duration: 0,
    });
    await update.downloadAndInstall();
    toasts.dismiss(progressId);
    toasts.success(tt('update.installed'), { duration: 0 });
    // Tauri installMode=passive → installer açılır, exit'te update biter.
    // Bazı sistemlerde otomatik relaunch eder; manuel relaunch çağırarak garantiye al:
    await relaunch();
    return true;
  } catch (err) {
    console.warn('updater: download/install failed', err);
    toasts.error(tt('update.failed'));
    return false;
  }
}

async function downloadOnly(update: Update): Promise<boolean> {
  const toasts = useToastsStore();
  try {
    const progressId = toasts.info(tt('update.downloadingBackground', { version: update.version }), {
      duration: 0,
    });
    await update.download();
    toasts.dismiss(progressId);
    localStorage.setItem(READY_UPDATE_KEY, update.version);
    return true;
  } catch (err) {
    console.warn('updater: download failed', err);
    toasts.error(tt('update.failed'));
    return false;
  }
}

async function installCached(update: Update): Promise<boolean> {
  try {
    await update.install();
    localStorage.removeItem(READY_UPDATE_KEY);
    await relaunch();
    return true;
  } catch (err) {
    console.warn('updater: install failed', err);
    const toasts = useToastsStore();
    toasts.error(tt('update.failed'));
    return false;
  }
}

/** Açılışta otomatik check — settings.updateCheckFrequency'e göre debounce.
 *  `startup` ise debounce yok (her açılışta check). Diğerlerinde
 *  lastCheckAt + minimum interval kontrolü. Rust loglarını kirletmemek için
 *  silent=true. */
export async function autoCheckOnStartup() {
  const settings = useSettingsStore();
  if (settings.state.updateMode === 'off') return;
  const freq = settings.state.updateCheckFrequency;
  if (freq !== 'startup') {
    const sinceLast = Date.now() - lastCheckAt();
    if (sinceLast < FREQUENCY_TO_MS[freq]) return;
  }
  await checkForUpdate(true);
}
