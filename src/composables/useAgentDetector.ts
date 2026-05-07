// Heuristic agent detector — TerminalPane line stream'inden Claude Code,
// Codex, aider gibi araçların output'unda agent yaşam döngüsü pattern'lerini
// yakalar ve agentWatch store'una sentetik AgentEvent dispatch eder.
//
// Tasarım kararı:
// - **Conservative**: false positive kabul edilebilir değil. Agent olmayan
//   şeyler agent gibi görünürse kullanıcı sidebar'a güvenmez. Bu yüzden
//   patterns dar ve zorunlu prefix'lere (markers) bağlı.
// - **Stateful**: agent ID'leri name → id map'i ile tutulur, end event'i
//   doğru start'a bağlanır.
// - **OSC önceliği**: Bu detector, OSC 9999 ile zaten dispatch edilmiş
//   agent'ları override etmez — formal protokolün heuristic'ten önceliği var.
//
// Pattern listesi yaşayan bir belge — yeni AI tool eklenince patterns dizisine
// ekle, kullanıcı override edebilsin diye Triggers sistemine de preset koy.

import { useAgentWatchStore } from '@/stores/agentWatch';
import type { AgentEvent } from '@/types/agent';

interface DetectorState {
  /** Agent name → synthetic id. End event'inin doğru start'a bağlanması için. */
  activeByName: Map<string, string>;
  /** Toplam sayaç — id eşsizliği için. */
  counter: number;
}

const stateByPane = new Map<string, DetectorState>();

function getState(paneId: string): DetectorState {
  let s = stateByPane.get(paneId);
  if (!s) {
    s = { activeByName: new Map(), counter: 0 };
    stateByPane.set(paneId, s);
  }
  return s;
}

/** Pane unmount'ta state temizle (memory leak engelle). */
export function clearAgentDetectorState(paneId: string) {
  stateByPane.delete(paneId);
}

// ── Pattern'ler ─────────────────────────────────────────────────────────────
//
// Claude Code visible output (gözleme dayalı, sürüm-spesifik olabilir):
//   ● Agent(Refactor types in foo.ts)
//     ⎿  ...
//   ⏺ Task(Search docs)
//
// Pattern'ler runtime'da inşa — no-control-regex literal regex'i hedefler.
const AGENT_START_PATTERNS: RegExp[] = [
  // ● veya ⏺ marker + Agent/Task( name )
  /[●⏺]\s+(?:Agent|Task)\s*\(\s*(.+?)\s*\)/,
  // Claude Code subagent dispatching: "Running N agents in parallel:" sonrası
  // genelde sıralı agent başlıkları gelir. Bu pattern paralel dispatch'in
  // birinci satırını tespit eder.
  /Running\s+(\d+)\s+agents?\s+in\s+parallel/i,
];

const AGENT_END_PATTERNS: RegExp[] = [
  // Claude Code completion: ⎿  Done (3.2k tokens, 4.1s)
  /⎿\s+(?:Done|Complete|Finished)/i,
];

const TOKEN_PATTERN = /\(?(\d+(?:[.,]\d+)?)\s*([Kk]?)\s*(?:tokens?|tok)\b/;

/** Tek satırı işle, detected event'leri döndür.
 *  Yan etki: state.activeByName güncellenir. */
export function detectAgentEventsFromLine(
  line: string,
  state: DetectorState,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!line) return events;

  // Start
  for (const re of AGENT_START_PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    // "Running N agents" pattern'i sayı verir, isim yok — generic başlık
    const name = m[1] && !/^\d+$/.test(m[1])
      ? m[1].trim()
      : `Parallel batch (${m[1]})`;
    if (state.activeByName.has(name)) break; // zaten aktif
    state.counter += 1;
    const id = `heur-${state.counter}-${Date.now().toString(36)}`;
    state.activeByName.set(name, id);
    events.push({ k: 'start', id, name });
    break;
  }

  // End
  for (const re of AGENT_END_PATTERNS) {
    if (!re.test(line)) continue;
    // En son aktif olan agent'ı bitir (LIFO yaklaşımı — Claude Code'da
    // agent'lar genellikle sırayla biter; doğru olmayan eşleşme nadir).
    const last = [...state.activeByName.entries()].pop();
    if (!last) break;
    const [name, id] = last;
    state.activeByName.delete(name);
    events.push({ k: 'end', id, status: 'ok' });
    break;
  }

  // Token info — son aktif agent'ın token'ı olarak işle
  const tokMatch = TOKEN_PATTERN.exec(line);
  if (tokMatch && state.activeByName.size > 0) {
    const num = parseFloat(tokMatch[1]!.replace(',', '.'));
    const kSuffix = tokMatch[2]?.toLowerCase() === 'k';
    const total = Math.round(kSuffix ? num * 1000 : num);
    const last = [...state.activeByName.values()].pop();
    if (last) {
      // Heuristic: tüm token sayısı output sayılır (input bilinmez)
      events.push({ k: 'tokens', id: last, out: total });
    }
  }

  return events;
}

/** Public hook: TerminalPane'in line stream'inden çağrılır.
 *  agentWatch store'una event dispatch eder. */
export function feedAgentDetector(line: string, paneId: string) {
  const state = getState(paneId);
  const events = detectAgentEventsFromLine(line, state);
  if (events.length === 0) return;
  const watcher = useAgentWatchStore();
  for (const ev of events) {
    watcher.dispatch(paneId, ev);
  }
}
