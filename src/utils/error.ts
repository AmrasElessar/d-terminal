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
