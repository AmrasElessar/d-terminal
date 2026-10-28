// Tauri command hata formatlamasını standartlaştır.
//
// Rust AppError serde ile { kind: string, message: string } olarak gönderir
// (src-tauri/src/error.rs). JS catch'te bu obje gelir, String(obj) yapılınca
// "[object Object]" üretir — kullanıcıya anlamsız.
//
// formatError() farklı hata şekillerini ele alır:
//   - { kind, message }   → "[kind] message"
//   - { message }          → "message"
//   - Error instance       → e.message
//   - string               → string
//   - other                → JSON.stringify (debug için)

export interface RustError {
  kind?: string;
  message?: string;
}

export function formatError(e: unknown): string {
  if (e == null) return 'unknown error';
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (typeof e === 'object') {
    const r = e as RustError;
    if (r.kind && r.message) return `[${r.kind}] ${r.message}`;
    if (r.message) return r.message;
    if (r.kind) return r.kind;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

/** Backend'in döndürdüğü makine-okunur hata kodları → i18n anahtarı.
 *  Kod mesajın tamamı ya da `[kind] code` biçiminde gelebilir; kelime
 *  sınırıyla aranır. */
const BACKEND_ERROR_CODES: Array<[RegExp, string]> = [
  [/\bendpointNotBoundToKey\b/, 'errors.backend.endpointNotBoundToKey'],
  [/\bendpointMustBeLocal\b/, 'errors.backend.endpointMustBeLocal'],
  [/\bduplicateStreamId\b/, 'errors.backend.duplicateStreamId'],
  [/\bqueryNotAllowed\b/, 'errors.backend.queryNotAllowed'],
  [/\bcredentialsInUrl\b/, 'errors.backend.credentialsInUrl'],
  [/log extension not allowed/i, 'errors.backend.logStreamFileType'],
  [/credential\/app-data directories/i, 'errors.backend.logStreamSensitivePath'],
];

/** Bilinen backend hata kodunun i18n anahtarı; yoksa null. */
export function backendErrorKey(e: unknown): string | null {
  const msg = formatError(e);
  for (const [re, key] of BACKEND_ERROR_CODES) {
    if (re.test(msg)) return key;
  }
  return null;
}

/** Kullanıcıya gösterilecek hata metni: bilinen kodlar çevrilir, diğerleri
 *  `formatError` ile. `t` çağıranın i18n fonksiyonu (komponent veya global). */
export function localizeError(e: unknown, t: (key: string) => string): string {
  const key = backendErrorKey(e);
  return key ? t(key) : formatError(e);
}
