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
// Claude Code visible output (gözlenmiş, sürüm-spesifik olabilir):
//
// 1) Çalışırken tek agent çağrısı (varsayım, doğrulanmamış):
//      ● Agent(Refactor types in foo.ts)
//      ⏺ Task(Search docs)
//
// 2) Paralel batch — agent'lar bittikten sonra TEK BLOK olarak çıkar:
//      3 agents finished (ctrl+o to expand)
//         ├ opus-perf-cleanup: Interval/listener cleanup fix · 39 tool uses · 42.5k tokens
//         │ ⎿  Done
//         ├ opus-perf-firestore: N+1 Firestore Promise.all fix · 16 tool uses · 73.1k tokens
//         │ ⎿  Done
//         └ opus-code-quality: Silent catches + dead buttons fix · 13 tool uses · 41.7k tokens
//           ⎿  Done
//
//    Her ├ veya └ satırı bir agent'ı temsil eder. Detector bu bloğu görünce
//    her agent için retroactive start+tokens+end event'leri sentezler — yani
//    sidebar/auto-split run BİTTİKTEN sonra populate olur (canlı değil ama
//    en azından kayıt tutulur).
//
// Pattern'ler runtime'da inşa — no-control-regex literal regex'i hedefler.

const AGENT_START_PATTERNS: RegExp[] = [
  // ● veya ⏺ marker + Agent/Task( name )
  /[●⏺]\s+(?:Agent|Task)\s*\(\s*(.+?)\s*\)/,
  // Claude Code subagent dispatching: "Running N agents in parallel:"
  /Running\s+(\d+)\s+agents?\s+in\s+parallel/i,
];

const AGENT_END_PATTERNS: RegExp[] = [
  // Claude Code completion: ⎿  Done
  /⎿\s+(?:Done|Complete|Finished)/i,
];

const TOKEN_PATTERN = /\(?(\d+(?:[.,]\d+)?)\s*([Kk]?)\s*(?:tokens?|tok)\b/;

/** Claude Code paralel batch satırı:
 *    `   ├ <id>: <description> · <N> tool uses · <X>k tokens`
 *  Hem RUNNING hem FINISHED durumda aynı format. TUI cursor positioning ile
 *  redraw edildiği için stream'de \n boundary olmayabilir → anchor YOK,
 *  global flag (g) ile chunk içinde tüm match'ler bulunur. */
const PARALLEL_AGENT_ROW = /[├└]\s+([\w.-]+):\s+(.+?)\s+·\s+\d+\s+tool uses?\s+·\s+([\d.]+)\s*([Kk])?\s+tokens?/g;

/** Tek satırı işle, detected event'leri döndür.
 *  Yan etki: state.activeByName güncellenir.
 *  Paralel batch satırları artık chunk-bazlı (feedAgentDetectorChunk)
 *  — bu fonksiyon hâlâ generic patterns için çağrılır. */
export function detectAgentEventsFromLine(
  line: string,
  state: DetectorState,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!line) return events;

  // — Generic start (varsayımsal pattern'ler) —
  for (const re of AGENT_START_PATTERNS) {
    const m = re.exec(line);
    if (!m) continue;
    // "Running N agents" pattern'i sayı verir, isim yok — generic başlık
    const name = m[1] && !/^\d+$/.test(m[1])
      ? m[1].trim()
      : `Parallel batch (${m[1]})`;
    if (state.activeByName.has(name)) break;
    state.counter += 1;
    const id = `heur-${state.counter}-${Date.now().toString(36)}`;
    state.activeByName.set(name, id);
    events.push({ k: 'start', id, name });
    break;
  }

  // — Generic end —
  for (const re of AGENT_END_PATTERNS) {
    if (!re.test(line)) continue;
    const last = [...state.activeByName.entries()].pop();
    if (!last) break;
    const [name, id] = last;
    state.activeByName.delete(name);
    events.push({ k: 'end', id, status: 'ok' });
    break;
  }

  // — Token info (sadece active agent varsa) —
  const tokMatch = TOKEN_PATTERN.exec(line);
  if (tokMatch && state.activeByName.size > 0) {
    const num = parseFloat(tokMatch[1]!.replace(',', '.'));
    const kSuffix = tokMatch[2]?.toLowerCase() === 'k';
    const total = Math.round(kSuffix ? num * 1000 : num);
    const last = [...state.activeByName.values()].pop();
    if (last) {
      events.push({ k: 'tokens', id: last, out: total });
    }
  }

  return events;
}

/** Chunk-bazlı paralel batch detector — tüm metni tarayıp agent satırlarını
 *  bulur. TUI redraw'da \n olmayabilir; bu yüzden line-bazlı yerine global
 *  regex ile tüm chunk'ı ararız. State.activeByName her id için dedup yapar.
 *  TerminalPane chunk geldikçe bunu çağırır. */
export function detectParallelAgentRows(
  text: string,
  state: DetectorState,
): AgentEvent[] {
  const events: AgentEvent[] = [];
  if (!text) return events;
  // Global regex — yeni `matchAll` ile tüm match'leri yakala
  PARALLEL_AGENT_ROW.lastIndex = 0;
  for (const par of text.matchAll(PARALLEL_AGENT_ROW)) {
    const id = par[1]!.trim();
    const desc = par[2]!.trim();
    const name = `${id}: ${desc}`;
    const num = parseFloat(par[3]!.replace(',', '.'));
    const kSuffix = par[4]?.toLowerCase() === 'k';
    const total = Math.round(kSuffix ? num * 1000 : num);
    // Yeni agent: start + tokens dispatch et
    if (!state.activeByName.has(id)) {
      state.activeByName.set(id, id);
      events.push({ k: 'start', id, name });
      if (total > 0) events.push({ k: 'tokens', id, out: total });
    } else if (total > 0) {
      // Aynı agent — token sayısı arttıysa update (Claude Code redraw'da
      // yeni token sayısı gelir).
      events.push({ k: 'tokens', id, out: total });
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

/** Chunk-bazlı public hook — TUI redraw senaryolarında \n boundary olmadan
 *  da paralel agent satırlarını yakalar. ANSI strip'ten sonraki HAM chunk
 *  ile çağrılır (line-buffered olmamış). */
export function feedAgentDetectorChunk(text: string, paneId: string) {
  const state = getState(paneId);
  const events = detectParallelAgentRows(text, state);
  if (events.length === 0) return;
  const watcher = useAgentWatchStore();
  for (const ev of events) {
    watcher.dispatch(paneId, ev);
  }
}
