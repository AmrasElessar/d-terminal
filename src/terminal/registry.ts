// Terminal session registry — leaf id → canlı TerminalSession.
//
// Bağımlılıksız modül: panes store'u buradan `disposeTerminalSession` çağırır,
// session modülü panes store'u import eder; doğrudan session import'u
// döngüsel bağımlılık yaratırdı.

export interface DisposableSession {
  dispose(): void;
}

const sessions = new Map<string, DisposableSession>();

export function getTerminalSession<T extends DisposableSession>(leafId: string): T | null {
  return (sessions.get(leafId) as T | undefined) ?? null;
}

export function registerTerminalSession(leafId: string, session: DisposableSession): void {
  const prev = sessions.get(leafId);
  if (prev && prev !== session) prev.dispose();
  sessions.set(leafId, session);
}

/** Pane kalıcı olarak kapandığında çağrılır (closePane / closeTab /
 *  loadWorkspace). PTY kill'i çağıranın sorumluluğunda; burada xterm, stdout
 *  listener'ı ve per-pane state temizlenir. Idempotent. */
export function disposeTerminalSession(leafId: string): void {
  const s = sessions.get(leafId);
  if (!s) return;
  sessions.delete(leafId);
  try {
    s.dispose();
  } catch (e) {
    console.warn('terminal session dispose:', e);
  }
}

export function terminalSessionCount(): number {
  return sessions.size;
}
