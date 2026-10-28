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

export type AgentEventKind = 'start' | 'progress' | 'tokens' | 'thinking' | 'await' | 'end';

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

/** Agent kullanıcı onayı bekliyor (örn. "Run this command? (y/n)"). UI
 *  duruma sarı pulse + "Onay bekliyor" rozeti gösterir, title bar yanıp söner. */
export interface AgentEventAwait {
  k: 'await';
  id: string;
  /** Onay istenen işlem — kısa açıklama. UI'da satır altında gösterilir. */
  prompt?: string;
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
  | AgentEventAwait
  | AgentEventEnd;

// ─── Store-side state ────────────────────────────────────────────────────────

export type AgentStatus = 'running' | 'waiting' | 'done' | 'error' | 'aborted';

export interface AgentInfo {
  id: string;
  name: string;
  parent?: string;
  status: AgentStatus;
  startedAt: number; // ms
  endedAt?: number;
  inputTokens: number;
  outputTokens: number;
  /** Cost — provider event'te explicit gönderdiyse bu set edilir, yoksa
   *  store'da seçili modelden hesaplanır (modelden hesap costUsd null tutar
   *  ve UI on-the-fly hesaplar). */
  costUsd: number;
  /** Stream'e gelen toplam metin (truncate'li). UI'da scroll edilir. */
  output: string;
  /** Reasoning blokları — accordion için. */
  thinking: string[];
  /** Onay beklerken kullanıcıya gösterilen kısa açıklama. */
  awaitPrompt?: string;
  error?: string;
}

/** Wire limitleri — terminal çıktısı güvenilmez; `cat` edilen bir dosya
 *  sahte OSC 9999 basabilir. */
const MAX_ID_LEN = 128;
const MAX_RAW_LEN = 64 * 1024;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isOptStr = (v: unknown) => v === undefined || typeof v === 'string';
const isOptNum = (v: unknown) =>
  v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/** OSC payload'unu güvenli parse et. Bozuk JSON veya şemaya uymayan alan
 *  tipleri gelirse null — store'a yalnızca tip-güvenli event ulaşır (önceden
 *  `{"k":"progress","id":"a","msg":5}` xterm parser'ı içinde TypeError atıyordu). */
export function parseAgentEvent(raw: string): AgentEvent | null {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_LEN) return null;
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const { k, id } = obj;
  if (!isStr(k) || !isStr(id) || id.length === 0 || id.length > MAX_ID_LEN) return null;
  switch (k) {
    case 'start':
      if (!isOptStr(obj.name) || !isOptStr(obj.parent)) return null;
      return { k, id, name: (obj.name as string | undefined) ?? '', parent: obj.parent as string | undefined };
    case 'progress':
      if (!isStr(obj.msg)) return null;
      return { k, id, msg: obj.msg };
    case 'tokens':
      if (!isOptNum(obj.in) || !isOptNum(obj.out) || !isOptNum(obj.cost)) return null;
      return {
        k,
        id,
        in: obj.in as number | undefined,
        out: obj.out as number | undefined,
        cost: obj.cost as number | undefined,
      };
    case 'thinking':
      if (!isStr(obj.text)) return null;
      return { k, id, text: obj.text };
    case 'await':
      if (!isOptStr(obj.prompt)) return null;
      return { k, id, prompt: obj.prompt as string | undefined };
    case 'end': {
      const status = obj.status;
      if (status !== 'ok' && status !== 'error' && status !== 'aborted') return null;
      if (!isOptStr(obj.error)) return null;
      return { k, id, status, error: obj.error as string | undefined };
    }
    default:
      return null;
  }
}

/** Agent maliyeti: provider explicit `cost` yaydıysa o, yoksa token × fiyat.
 *  Fiyat bilinmiyorsa (ve token varsa) null. */
export function agentEffectiveCost(
  a: Pick<AgentInfo, 'costUsd' | 'inputTokens' | 'outputTokens'>,
  price: { inputPer1M: number; outputPer1M: number } | undefined,
): number | null {
  if (a.costUsd !== 0 || (a.inputTokens === 0 && a.outputTokens === 0)) return a.costUsd;
  if (!price) return null;
  return (a.inputTokens / 1_000_000) * price.inputPer1M + (a.outputTokens / 1_000_000) * price.outputPer1M;
}
