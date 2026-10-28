// Per-pane git diff +/- tracking — title bar Δ chip için.
//
// Pane'in current working directory (CWD) belirlenmesi:
//   1. OSC 7 sequence: \e]7;file://host/path\a — modern shell prompts emit eder
//      (oh-my-posh, starship, PSReadLine ile). En doğru kaynak.
//   2. Fallback: pane profile'undaki cwd (sabit, prompt değişince güncellenmez).
//
// Polling: pane mounted iken her 10sn'de bir, ayrıca agent end event'inde
// anlık refresh. Pane unmount'ta state cleanup.
//
// Singleton-per-pane: hem TerminalPane (cwd setter, polling lifecycle) hem
// PaneTitleBar (chip render) aynı reactive ref'i paylaşır.

import { ref, type Ref } from 'vue';
import { api } from '@/api/tauri';

export interface PaneGitStat {
  files: number;
  added: number;
  removed: number;
  is_repo: boolean;
}

interface PaneState {
  cwd: string;
  ref: Ref<PaneGitStat>;
  timer: number | undefined;
  /** Aktif polling interval (ms). Adaptive — repo değilse SLOW, repo+değişiklik
   *  varsa FAST. Çok pane'li senaryolarda git binary spawn rate'ini düşürür. */
  intervalMs: number;
}

const stateByPane = new Map<string, PaneState>();

// FAST — kullanıcı aktif edit yapıyor (repo + değişiklik var); chip hızlı güncellensin
const FAST_POLL_MS = 5_000;
// SLOW — pane git repo değil veya temiz; gereksiz git binary spawn'ı azalt.
// 50 pane × 12/dk yerine 50 pane × 2/dk = 100/dk subprocess (thread pool friendly).
const SLOW_POLL_MS = 30_000;

function getOrCreateState(paneId: string): PaneState {
  let s = stateByPane.get(paneId);
  if (!s) {
    s = {
      cwd: '',
      ref: ref<PaneGitStat>({ files: 0, added: 0, removed: 0, is_repo: false }),
      timer: undefined,
      intervalMs: FAST_POLL_MS,
    };
    stateByPane.set(paneId, s);
  }
  return s;
}

/** Per-pane git stat ref'i — read-only kullanım için. PaneTitleBar bunu çağırır. */
export function gitStatRef(paneId: string): Ref<PaneGitStat> {
  return getOrCreateState(paneId).ref;
}

/** Yan etkisiz peek — TabBar tab başına toplam hesaplarken kullanır.
 *  `gitStatRef` çağrısı state yaratır (mount edilmemiş pane'ler için bile
 *  empty entry oluşur, polling timer'sız); aggregate listeleme bunu istemez.
 *  Var olmayan pane için `null` döner; caller sıfır olarak işler. */
export function peekGitStat(paneId: string): PaneGitStat | null {
  return stateByPane.get(paneId)?.ref.value ?? null;
}

async function refreshOne(paneId: string) {
  const s = stateByPane.get(paneId);
  if (!s || !s.cwd) return;
  try {
    const result = await api.gitDiffShortstat(s.cwd);
    // Await sırasında pane kapatıldıysa (clearGitStatState) ya da state
    // yeniden yaratıldıysa eski nesne üzerinde timer kurma — orphan interval.
    if (stateByPane.get(paneId) !== s) return;
    s.ref.value = result;
    // Adaptive interval — repo değilse SLOW, repo ise FAST. Aktif polling
    // varsa interval değiştiğinde timer'ı yeniden kur.
    const desired = result.is_repo ? FAST_POLL_MS : SLOW_POLL_MS;
    if (s.timer !== undefined && s.intervalMs !== desired) {
      window.clearInterval(s.timer);
      s.intervalMs = desired;
      s.timer = window.setInterval(() => {
        void refreshOne(paneId);
      }, desired);
    }
  } catch {
    /* git çağrısı başarısız → mevcut değeri koru */
  }
}

/** OSC 7 ya da başka bir kaynaktan cwd geldiğinde TerminalPane çağırır.
 *  Aynı cwd ise no-op (gereksiz git çağrısından kaçın). */
export function setPaneCwd(paneId: string, newCwd: string) {
  if (!isSafeLocalDrivePath(newCwd)) return;
  const s = getOrCreateState(paneId);
  if (s.cwd === newCwd) return;
  s.cwd = newCwd;
  void refreshOne(paneId);
}

/** Polling başlat — TerminalPane mount'ta. Default FAST interval ile başlar;
 *  ilk refresh sonucu repo değilse otomatik SLOW'a düşer. */
export function startGitStatPolling(paneId: string) {
  const s = getOrCreateState(paneId);
  if (s.timer !== undefined) return;
  s.intervalMs = FAST_POLL_MS;
  s.timer = window.setInterval(() => {
    void refreshOne(paneId);
  }, s.intervalMs);
}

/** Manuel refresh — agent end event'inde anlık update için. */
export function refreshGitStat(paneId: string) {
  void refreshOne(paneId);
}

/** TerminalPane unmount'ta cleanup. */
export function clearGitStatState(paneId: string) {
  const s = stateByPane.get(paneId);
  if (s && s.timer !== undefined) {
    window.clearInterval(s.timer);
    s.timer = undefined;
  }
  stateByPane.delete(paneId);
}

/**
 * OSC 7 payload parser — `file://host/path` formatını local path'e çevirir.
 * Windows path'leri `file:///C:/path` formatında gelir, başındaki üçlü slash
 * sonra drive letter. URL-decode da gerekebilir (boşluklar %20 olur).
 *
 * GÜVENLİK: OSC 7 terminal çıktısından gelir — `cat dosya.txt`, ssh oturumu
 * veya herhangi bir program bu diziyi basabilir. Dönen yol backend'de
 * `git` çalıştırmak için kullanıldığından yalnızca yerel, sürücü harfli mutlak
 * yollar kabul edilir:
 *   - host boş, `localhost` veya düz bir makine adı (PowerShell init
 *     `$env:COMPUTERNAME` yayar) olmalı — host zaten yok sayılır;
 *   - yol `X:\...` biçiminde olmalı; UNC (`\\host\share`, `//host`),
 *     NT/Win32 device (`\\?\`, `\\.\`, `\??\`) ve `..` segmentleri
 *     reddedilir (UNC'ye erişim Windows'ta NTLM hash sızdırır).
 */
export function parseOsc7CwdPayload(payload: string): string | null {
  if (typeof payload !== 'string' || payload.length > 4096) return null;
  // Format: `file://[host]/path`
  const m = /^file:\/\/([^/]*)(\/.*)$/.exec(payload);
  if (!m) return null;
  const host = m[1]!;
  if (host !== '' && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(host)) return null;
  let path = m[2]!;
  // URL decode
  try {
    path = decodeURIComponent(path);
  } catch {
    /* invalid URL encoding — ham haliyle doğrulamaya devam */
  }
  // Kontrol karakteri içeren yol reddedilir
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(path)) return null;
  // Windows: /C:/path → C:/path (leading slash drop)
  if (!/^\/[A-Za-z]:[\\/]/.test(path) && !/^\/[A-Za-z]:$/.test(path)) return null;
  path = path.slice(1);
  // Backslash normalize (Rust filesystem uyumlu)
  path = path.replace(/\//g, '\\');
  if (!isSafeLocalDrivePath(path)) return null;
  return path;
}

/** `C:\...` biçiminde, UNC/device/`..` içermeyen yerel yol mu? */
export function isSafeLocalDrivePath(path: string): boolean {
  if (!/^[A-Za-z]:(\\|$)/.test(path)) return false;
  if (path.startsWith('\\\\') || path.startsWith('//')) return false;
  if (/^\\(\?\?|\?|\.)\\/.test(path)) return false;
  // Sürücü harfinden sonra ikinci bir ':' (ADS / device) olmasın
  if (path.indexOf(':', 2) !== -1) return false;
  if (path.split('\\').some((seg) => seg === '..')) return false;
  return true;
}
