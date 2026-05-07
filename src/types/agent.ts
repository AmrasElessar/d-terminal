// Agent Watch — D-Terminal'in AI tool observer protokolü.
//
// Terminal'de çalışan AI tool'ları (Claude Code, Codex, aider, vb.)
// D-Terminal'i tespit ederse (TERM_PROGRAM=D-Terminal) opt-in olarak özel OSC
// sequence yayar. D-Terminal bu sequence'i parse edip per-pane "Agent Watch"
// sidebar'ında canlı gösterir.
//
// Wire format (OSC 9999):
//
//   ESC ] 9999 ; <event-json> BEL
//
// Örnek:
//   \e]9999;{"k":"start","id":"a1","name":"Refactor types"}\a
//   \e]9999;{"k":"tokens","id":"a1","in":1240,"out":820}\a
//   \e]9999;{"k":"end","id":"a1","status":"ok"}\a
//
// `k` field'ı kısa tutulur (her satır bandwidth'ten kazanır). `id` agent
// içinde unique olmalı; aynı id ile gelen `start` mevcut agent'ı reset eder.
//
// Cooperation yoksa: heuristic detector (Triggers preset) ile yaklaşık
// agent yaşam döngüsü tespit edilir, doğruluk düşük olabilir.

export type AgentEventKind = 'start' | 'progress' | 'tokens' | 'thinking' | 'end';

/** OSC 9999 wire payload — minimal, agresif kısaltma kullanılır. */
export interface AgentEventStart {
  k: 'start';
  id: string;
  /** İnsan-okunur kısa açıklama. */
  name: string;
  /** Parent agent id — subagent ise. Top-level için yok. */
  parent?: string;
}

export interface AgentEventProgress {
  k: 'progress';
  id: string;
  /** Stream'e eklenecek metin parçası. */
  msg: string;
}

export interface AgentEventTokens {
  k: 'tokens';
  id: string;
  in?: number;
  out?: number;
  /** Cumulative cost (USD) — provider biliyorsa yayar. */
  cost?: number;
}

export interface AgentEventThinking {
  k: 'thinking';
  id: string;
  /** Reasoning bloğu metni. UI accordion altında gizli. */
  text: string;
}

export interface AgentEventEnd {
  k: 'end';
  id: string;
  status: 'ok' | 'error' | 'aborted';
  /** Hata mesajı (status=error). */
  error?: string;
}

export type AgentEvent =
  | AgentEventStart
  | AgentEventProgress
  | AgentEventTokens
  | AgentEventThinking
  | AgentEventEnd;

// ─── Store-side state ────────────────────────────────────────────────────────

export type AgentStatus = 'running' | 'done' | 'error' | 'aborted';

export interface AgentInfo {
  id: string;
  name: string;
  parent?: string;
  status: AgentStatus;
  startedAt: number; // ms
  endedAt?: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Stream'e gelen toplam metin (truncate'li). UI'da scroll edilir. */
  output: string;
  /** Reasoning blokları — accordion için. */
  thinking: string[];
  error?: string;
}

/** OSC payload'unu güvenli parse et. Bozuk JSON gelirse null. */
export function parseAgentEvent(raw: string): AgentEvent | null {
  try {
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || obj == null) return null;
    if (typeof obj.k !== 'string' || typeof obj.id !== 'string') return null;
    switch (obj.k) {
      case 'start':
      case 'progress':
      case 'tokens':
      case 'thinking':
      case 'end':
        return obj as AgentEvent;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
