<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ImageAddon } from '@xterm/addon-image';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';
import '@xterm/xterm/css/xterm.css';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { listen } from '@tauri-apps/api/event';
import { api } from '@/api/tauri';
import type { LeafNode, PaneType } from '@/types/pane';
import type { PtyEvent } from '@/types/events';
import { usePanesStore } from '@/stores/panes';
import { useThemeStore } from '@/stores/theme';
import { useSettingsStore, type RendererMode } from '@/stores/settings';
import { useToastsStore } from '@/stores/toasts';
import { useProfilesStore } from '@/stores/profiles';
import { xtermThemeOf } from '@/themes/apply';
import { createBlockTracker, registerBlockTracker, unregisterBlockTracker } from '@/composables/useBlocks';
import { createSmartLinkProvider } from '@/composables/useSmartLinks';
import { useTriggersStore } from '@/stores/triggers';
import { useModals } from '@/composables/useModals';
import { builtinShellInitArgs } from '@/shellInit';
import { formatError } from '@/utils/error';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ leaf: LeafNode }>();
const panes = usePanesStore();
const themeStore = useThemeStore();
const settings = useSettingsStore();
const toasts = useToastsStore();
const triggers = useTriggersStore();
const profiles = useProfilesStore();
const modals = useModals();
const { t } = useI18n();

/** Komut girdi buffer'ı — `#` prefix interception + inline autocomplete için.
 *  PROMPT'tan sonra sıfırlanır, Enter'da temizlenir, backspace'i kabul eder.
 *  blockTracker.inputAccumulator'dan ayrı tutuluyor çünkü bu sadece intercept
 *  kararı için lazım (block tracker ayrı amaca hizmet). */
let cmdBuffer = '';

// --- Inline autocomplete (history-based) ---
const suggestion = ref<string | null>(null);
let suggestDebounceTimer: number | undefined;
async function refreshSuggestion() {
  if (!settings.state.inlineAutocomplete) {
    suggestion.value = null;
    return;
  }
  const prefix = cmdBuffer.trim();
  if (prefix.length < 2) {
    suggestion.value = null;
    return;
  }
  try {
    const results = await api.historySearch({ text: prefix, limit: 20 });
    // İlk prefix-match'i bul (search substring döner; biz başlangıçta eşleşeni isteriz)
    const match = results.find((h) => h.command.startsWith(prefix) && h.command.length > prefix.length);
    suggestion.value = match ? match.command : null;
  } catch {
    suggestion.value = null;
  }
}
function scheduleSuggestion() {
  if (suggestDebounceTimer) window.clearTimeout(suggestDebounceTimer);
  suggestDebounceTimer = window.setTimeout(() => {
    suggestDebounceTimer = undefined;
    refreshSuggestion();
  }, 80);
}
function clearSuggestion() {
  suggestion.value = null;
  if (suggestDebounceTimer) {
    window.clearTimeout(suggestDebounceTimer);
    suggestDebounceTimer = undefined;
  }
}
/** Suffix'i (öneriden cmdBuffer'ı çıkar) PTY'ye yaz, cmdBuffer güncelle. */
function acceptSuggestion(): boolean {
  const s = suggestion.value;
  if (!s || !s.startsWith(cmdBuffer)) return false;
  const suffix = s.slice(cmdBuffer.length);
  if (!suffix) return false;
  const ptyId = panes.getLeaf(props.leaf.id)?.ptyId;
  if (!ptyId) return false;
  api.ptyWrite(ptyId, new TextEncoder().encode(suffix)).catch(() => {});
  cmdBuffer = s;
  clearSuggestion();
  return true;
}

// Trigger matching: line-buffered. PTY chunk'ları '\n' içerir, eksik son parça
// `pendingLine` içinde tutulur ve bir sonraki chunk ile birleştirilir. ANSI
// escape'ler matched text'i kirletmesin diye strip edilir.
// Control byte'lar (ESC=0x1B, BEL=0x07) runtime'da inşa — no-control-regex literal regex'i hedefler.
const _ESC = String.fromCharCode(0x1b);
const _BEL = String.fromCharCode(0x07);
const ANSI_RE = new RegExp(`${_ESC}\\[[0-9;?]*[a-zA-Z]|${_ESC}\\][^${_BEL}]*${_BEL}`, 'g');
let pendingLine = '';
function feedTriggers(text: string) {
  if (!text) return;
  pendingLine += text.replace(ANSI_RE, '');
  if (!pendingLine.includes('\n')) return;
  const parts = pendingLine.split('\n');
  pendingLine = parts.pop() ?? '';
  for (const line of parts) {
    if (line.length === 0) continue;
    triggers.matchLine(line, props.leaf.id, props.leaf.type);
  }
}

const container = ref<HTMLDivElement>();
let term: Terminal | null = null;
let fit: FitAddon | null = null;
let search: SearchAddon | null = null;
let serialize: SerializeAddon | null = null;
let webgl: WebglAddon | null = null;
let canvas: CanvasAddon | null = null;
let unlistenStdout: UnlistenFn | null = null;

// --- Search overlay state ---
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement>();
const searchCaseSensitive = ref(false);
const searchWholeWord = ref(false);
const searchRegex = ref(false);
const searchResultCount = ref<{ resultIndex: number; resultCount: number } | null>(null);

const searchOptions = computed<ISearchOptions>(() => ({
  caseSensitive: searchCaseSensitive.value,
  wholeWord: searchWholeWord.value,
  regex: searchRegex.value,
  decorations: {
    matchBackground: '#FFB454',
    matchOverviewRuler: '#FFB454',
    activeMatchBackground: '#FF8C42',
    activeMatchColorOverviewRuler: '#FF8C42',
  },
}));

// Block tracker — OSC 133 marker'larından komut + çıktı + exit code yakalar.
// Global registry'ye paneId ile kaydedilir; PaneSlot/BlockPanel oradan okur.
const blockTracker = createBlockTracker();
registerBlockTracker(props.leaf.id, blockTracker);

/** PTY canlı kalsın diye global buffer cache.
 *  Tree restructure (split kapatma) Vue komponentini destroy/remount ediyor.
 *  Eski davranışta her remount'ta yeni pty_spawn çağrılır → çalışan komut
 *  kayboluyordu. Şimdi:
 *   - unmount öncesi xterm buffer'ını serialize et + cache'le
 *   - mount sonrası leaf.ptyId varsa yeniden spawn ETME, sadece listener kur
 *   - cached buffer'ı term.write ile geri yaz
 *  Map global modül scope — komponent destroy'unda kaybolmaz. closePane
 *  callback'i panes store içinde delete eder (memory leak önleme). */
interface PaneBufferGlobal { __dtermPaneBuffer?: Map<string, string> }
const _g = globalThis as unknown as PaneBufferGlobal;
const paneBufferCache: Map<string, string> =
  _g.__dtermPaneBuffer ?? (_g.__dtermPaneBuffer = new Map());

// Shell init script'leri src/shellInit/ altında ayrı dosyalara taşındı:
//   powershell.ps1 → renkli prompt + OSC 0 title + OSC 133 shell integration
//   cmd-prompt.txt → ANSI prompt setter
// Kullanıcı tanımlı profiller (SSH, Docker vb.) için init script'i çalışmaz —
// sadece built-in profiller için inject edilir (shellInitArgsFor altta).
function shellInitArgsFor(paneType: PaneType, isBuiltin: boolean): string[] {
  return isBuiltin ? builtinShellInitArgs(paneType) : [];
}

async function spawn() {
  if (!term || !fit || !container.value) return;
  fit.fit();
  const { cols, rows } = term;

  // Reattach senaryosu: Vue komponenti destroy/remount oldu (split tree
  // restructure) ama backend PTY canlı. Yeniden spawn ETME — eski PTY'ye
  // yeniden bağlan. Cache'lenmiş buffer'ı replay et ki kullanıcı tarihçeyi
  // kaybetmesin. Sonraki output'lar listenStdout üzerinden gelmeye devam.
  if (props.leaf.ptyId && props.leaf.status === 'running') {
    const cached = paneBufferCache.get(props.leaf.id);
    if (cached) term.write(cached);
    await listenStdout(props.leaf.ptyId);
    // Backend'e yeni cols/rows bildir — pencere boyutu değişmiş olabilir
    api.ptyResize(props.leaf.ptyId, cols, rows).catch(() => {});
    return;
  }

  // Profil seçimi: leaf.profileId varsa onu kullan, yoksa paneType'ın varsayılan
  // built-in profili. Hiçbir terminal profili paneType'a uymuyorsa (aiChat, welcome
  // gibi non-shell tipler) spawn atlanır.
  const profile = props.leaf.profileId
    ? profiles.find(props.leaf.profileId)
    : profiles.defaultFor(props.leaf.type);
  if (!profile) {
    panes.setLeafState(props.leaf.id, { status: 'idle' });
    return;
  }
  const initArgs = shellInitArgsFor(profile.paneType, profile.builtin);

  panes.setLeafState(props.leaf.id, { status: 'spawning' });
  try {
    const ptyId = await api.ptySpawn({
      shell: profile.shell,
      args: [...profile.args, ...initArgs],
      cwd: profile.cwd && profile.cwd.length > 0 ? profile.cwd : undefined,
      env:
        profile.env && Object.keys(profile.env).length > 0
          ? Object.entries(profile.env)
          : undefined,
      cols,
      rows,
    });
    panes.setLeafState(props.leaf.id, { ptyId, status: 'running' });
    await listenStdout(ptyId);
  } catch (e: unknown) {
    panes.setLeafState(props.leaf.id, { status: 'error', errorMessage: formatError(e) });
  }
}

async function listenStdout(ptyId: string) {
  if (unlistenStdout) {
    unlistenStdout();
    unlistenStdout = null;
  }
  unlistenStdout = await listen<PtyEvent>('pty://stdout', (e) => {
    if (e.payload.kind !== 'stdout') return;
    if (e.payload.pane_id !== ptyId) return;
    if (!term) return;
    const bytes = new Uint8Array(e.payload.data);
    // xterm yazımı: ANSI/OSC parse + render (OSC 133 handler tetiklenir)
    term.write(bytes);
    // Block tracker — output topla (görsel olarak xterm zaten render ediyor;
    // burada metadata için saklarız, AI'a gönderme/copy block için kullanılır).
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    blockTracker.onOutput(text);
    // Trigger matching — line-buffered, ANSI strip
    feedTriggers(text);
  });
}

function attachInput() {
  if (!term) return;
  term.onData((data) => {
    const myPtyId = panes.getLeaf(props.leaf.id)?.ptyId;
    if (!myPtyId) return;

    // # prefix interception (Warp Agent Mode paritesi):
    // boş prompt'tayken tek başına `#` yazılırsa PTY'ye yazma, AI suggest modal aç.
    if (
      settings.state.aiPrefixHash &&
      data === '#' &&
      cmdBuffer === ''
    ) {
      panes.focus(props.leaf.id);
      modals.open('aiSuggest');
      return;
    }

    // Inline autocomplete kabul: Tab (\t) veya → (\x1b[C) ve aktif öneri varsa
    // PTY'ye gitmeden suggestion suffix'ini yaz.
    if (suggestion.value && (data === '\t' || data === '\x1b[C')) {
      if (acceptSuggestion()) return;
    }

    // Buffer güncelleme
    let bufferChanged = false;
    if (data.includes('\r') || data.includes('\n')) {
      cmdBuffer = '';
      clearSuggestion();
    } else if (data === '\x7f' || data === '\b') {
      cmdBuffer = cmdBuffer.slice(0, -1);
      bufferChanged = true;
    } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
      cmdBuffer += data;
      bufferChanged = true;
    } else if (data.length > 1) {
      // Çok karakterli (paste vb.) — # interception devre dışı, autocomplete de
      cmdBuffer += data;
      bufferChanged = true;
    }
    if (bufferChanged) scheduleSuggestion();

    // Block tracker — kullanıcı input'unu yakala (komut metni için)
    blockTracker.onUserInput(data);
    const bytes = new TextEncoder().encode(data);
    if (panes.broadcastInput) {
      // Aktif tab'daki tüm çalışan terminal pane'lerine paralel yaz (tmux sync-panes)
      const targets = panes.allLeaves
        .filter((l) => l.ptyId && l.status === 'running')
        .map((l) => l.ptyId!);
      for (const ptyId of targets) {
        api.ptyWrite(ptyId, bytes).catch(() => {});
      }
    } else {
      api.ptyWrite(myPtyId, bytes).catch(() => {});
    }
  });
  // Resize IPC debounce: divider sürükleme sırasında her frame'de PTY'ye
  // boyut göndermek shell prompt'unun defalarca redraw edilmesine yol açar
  // (PowerShell her SIGWINCH'te prompt'u yeniden basar — scrollback'te
  // duplikasyon görünür). Kullanıcı sürüklemeyi bitirene kadar bekle.
  term.onResize(({ cols, rows }) => {
    const ptyId = panes.getLeaf(props.leaf.id)?.ptyId;
    if (!ptyId) return;
    if (resizeIpcTimer) clearTimeout(resizeIpcTimer);
    resizeIpcTimer = window.setTimeout(() => {
      resizeIpcTimer = 0;
      api.ptyResize(ptyId, cols, rows).catch(() => {});
    }, 120);
  });
  // OSC 0 (`ESC ]0;<title>BEL`) — terminal title değiştiğinde pane başlığı güncelle.
  term.onTitleChange((title) => {
    if (title && title.length > 0) {
      panes.setLeafState(props.leaf.id, { title });
    }
  });

  // OSC 133 — Shell Integration / Final Term protocol — block-based UI için.
  // Format: ESC ] 133 ; <command> ; <args> BEL
  //   A          → prompt start (yeni block)
  //   B          → command input başlıyor
  //   C          → command çalıştırıldı (output başlangıcı)
  //   D[;<exit>] → command bitti
  //   P;cwd=<x>  → cwd metadata
  // xterm parser API: registerOscHandler(133, fn). Return true = handled, propagate yok.
  term.parser.registerOscHandler(133, (data: string) => {
    const semi = data.indexOf(';');
    const cmd = semi >= 0 ? data.slice(0, semi) : data;
    const rest = semi >= 0 ? data.slice(semi + 1) : '';
    switch (cmd) {
      case 'A': blockTracker.onPromptStart(); cmdBuffer = ''; clearSuggestion(); break;
      case 'B': blockTracker.onCommandStart(); cmdBuffer = ''; clearSuggestion(); break;
      case 'C': blockTracker.onCommandRun(''); break;
      case 'D': {
        const exitCode = rest ? parseInt(rest, 10) : 0;
        const code = Number.isNaN(exitCode) ? 0 : exitCode;
        blockTracker.onCommandEnd(code);
        // Komutu geçmişe yaz — history-based autocomplete + Settings → History modal
        const block = blockTracker.active();
        if (block?.command) {
          const dur = block.endedAt && block.startedAt
            ? block.endedAt.getTime() - block.startedAt.getTime()
            : undefined;
          api.historyAdd({
            command: block.command,
            paneId: props.leaf.id,
            paneType: props.leaf.type,
            exitCode: code,
            durationMs: dur,
          }).catch(() => { /* offline / migration sırasında yutulur */ });
        }
        break;
      }
      case 'P': {
        // P;cwd=<path>
        const m = rest.match(/^cwd=(.+)$/);
        if (m) blockTracker.onCwd(m[1]!);
        break;
      }
    }
    return true;
  });

  // Search → result count event
  if (search) {
    search.onDidChangeResults((evt) => {
      searchResultCount.value = evt;
    });
  }
}

/** Resize coalescing — split/window resize burst'lerinde fit() defalarca
 *  tetiklenir, WebGL renderer'da siyah flicker'a sebep olur. rAF ile bir
 *  frame içindeki tüm resize istekleri tek fit çağrısında toplanır. */
let resizeRafId = 0;
let resizeIpcTimer = 0;
let paneResizeObserver: ResizeObserver | null = null;
function handleResize() {
  if (!fit) return;
  if (resizeRafId) return;
  resizeRafId = requestAnimationFrame(() => {
    resizeRafId = 0;
    if (!fit) return;
    try {
      fit.fit();
    } catch {
      /* container görünür değilse atla */
    }
  });
}

// Xterm font yokluğunda yanlış cell-width metric'ine düşmesin diye
// UI ile aynı sistem-mono fallback chain.
function buildFontFamily(primary: string): string {
  return `"${primary}", "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", monospace`;
}

/** Renderer addon yükle. WebGL desteklenmiyorsa canvas, o da yoksa DOM (default).
 *  Context loss event'inde otomatik canvas'a düşer.
 *  Dispose'lar try/catch ile sarılı — addon-webgl 0.19 context loss / double
 *  dispose senaryolarında undefined üzerinde patlar. */
function safeDispose(addon: { dispose(): void } | null) {
  if (!addon) return;
  try { addon.dispose(); } catch { /* zaten dispose edilmiş olabilir */ }
}

function applyRenderer(mode: RendererMode) {
  if (!term) return;
  // Mevcut renderer'ı temizle
  safeDispose(webgl); webgl = null;
  safeDispose(canvas); canvas = null;

  const tryWebgl = (): boolean => {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        // GPU context kaybedildiğinde canvas'a fallback
        safeDispose(webgl); webgl = null;
        const c = new CanvasAddon();
        try { term!.loadAddon(c); canvas = c; } catch { /* DOM fallback */ }
      });
      term!.loadAddon(addon);
      webgl = addon;
      return true;
    } catch {
      return false;
    }
  };
  const tryCanvas = (): boolean => {
    try {
      const addon = new CanvasAddon();
      term!.loadAddon(addon);
      canvas = addon;
      return true;
    } catch {
      return false;
    }
  };

  switch (mode) {
    case 'webgl': tryWebgl() || tryCanvas(); break;
    case 'canvas': tryCanvas(); break;
    case 'dom': /* default; addon yok */ break;
    case 'auto':
    default: tryWebgl() || tryCanvas(); break;
  }
}

// --- Search API ---
function openSearch() {
  searchOpen.value = true;
  nextTick(() => searchInput.value?.focus());
}
function closeSearch() {
  searchOpen.value = false;
  search?.clearDecorations();
  searchResultCount.value = null;
  // Terminal'e fokusu geri ver
  term?.focus();
}
function findNext() {
  if (!search || !searchQuery.value) return;
  search.findNext(searchQuery.value, searchOptions.value);
}
function findPrev() {
  if (!search || !searchQuery.value) return;
  search.findPrevious(searchQuery.value, searchOptions.value);
}
/** Tip-while-search debounce — 10K satır buffer'da her tuş vuruşunda arama
 *  CPU yer. 250ms bekle + son tuşta tek arama. Enter ile anında tetik
 *  (onSearchKey'de zaten kullanıcı debounce'u bypass eder). */
let searchDebounceTimer: number | undefined;
function findNextDebounced() {
  if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = undefined;
    findNext();
  }, 250);
}
function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) findPrev(); else findNext();
  }
}

/** Buffer'ı text olarak export et — clipboard'a kopyala. */
function copyBuffer() {
  if (!serialize) return;
  const text = serialize.serialize({ excludeAltBuffer: true, excludeModes: true });
  // ANSI escape'leri xterm'e zaten renderlandı; serialize SGR'ları içerir, plain için strip
  const plain = text.replace(ANSI_RE, '');
  navigator.clipboard.writeText(plain).then(() => toasts.success(t('terminal.bufferCopied'), 1500));
}

// Pane-scoped key handler: Ctrl+F arama, Ctrl+Shift+C buffer kopyala, Ctrl+Shift+V paste
function onContainerKeydown(e: KeyboardEvent) {
  // Ctrl+F → arama overlay (browser find'ı override etme — terminal context'te beklenir)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    e.stopPropagation();
    openSearch();
  }
}

onMounted(async () => {
  if (!container.value) return;
  const xtheme = themeStore.active ? xtermThemeOf(themeStore.active) : undefined;
  term = new Terminal({
    fontFamily: buildFontFamily(settings.state.fontFamily),
    fontSize: settings.state.fontSize,
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    theme: xtheme,
    allowProposedApi: true,
    lineHeight: 1.2,
    letterSpacing: 0,
  });
  fit = new FitAddon();
  search = new SearchAddon();
  serialize = new SerializeAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  // iTerm2 inline image + sixel protokolleri (kitty graphics ayrı)
  term.loadAddon(new ImageAddon({ enableSizeReports: true, sixelSupport: true, iipSupport: true }));
  term.loadAddon(search);
  term.loadAddon(serialize);
  // Unicode 11: emoji + CJK genişliği için (allowProposedApi gerek)
  if (settings.state.unicode11) {
    const u11 = new Unicode11Addon();
    term.loadAddon(u11);
    term.unicode.activeVersion = '11';
  }

  term.open(container.value);

  // Renderer addon (WebGL / canvas / DOM) — open()'dan SONRA yüklenmeli
  applyRenderer(settings.state.renderer);

  // Smart link provider — file path / git SHA / IP tıklanabilir
  // (WebLinksAddon http URL'leri yakalar; bu onu tamamlar)
  term.registerLinkProvider(createSmartLinkProvider(term, {
    onPath: (p) => {
      shellOpen(p).catch(() => {
        navigator.clipboard.writeText(p).then(() => toasts.info(t('terminal.pathCopied'), 1500));
      });
    },
    onGitRef: (sha) => {
      navigator.clipboard.writeText(sha).then(() => toasts.success(t('terminal.shaCopied', { sha: sha.slice(0, 8) }), 1500));
    },
    onHost: (host) => {
      navigator.clipboard.writeText(host).then(() => toasts.info(t('terminal.hostCopied'), 1500));
    },
  }));

  attachInput();
  window.addEventListener('resize', handleResize);
  // Pane container'ı kendi başına da boyut değiştirebilir (split divider drag,
  // pane ekleme/kaldırma, layout değişimi). window resize bu durumlarda
  // tetiklenmez; ResizeObserver ile container'ı izle.
  if (container.value) {
    paneResizeObserver = new ResizeObserver(() => handleResize());
    paneResizeObserver.observe(container.value);
  }
  await spawn();
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  paneResizeObserver?.disconnect();
  paneResizeObserver = null;
  if (resizeIpcTimer) {
    clearTimeout(resizeIpcTimer);
    resizeIpcTimer = 0;
  }
  if (unlistenStdout) unlistenStdout();
  unregisterBlockTracker(props.leaf.id);

  // PTY hâlâ canlıysa (split kapatma sonrası tree restructure) buffer'ı
  // cache'le ki remount'ta replay edilsin. PTY ölmüşse cache'lemenin anlamı yok.
  if (props.leaf.ptyId && props.leaf.status === 'running' && term && serialize) {
    try {
      const snapshot = serialize.serialize({ excludeAltBuffer: true, excludeModes: true });
      paneBufferCache.set(props.leaf.id, snapshot);
    } catch { /* serialize hatası — cache atla */ }
  }

  // xterm-addon-webgl 0.19 çökme önleme:
  // Pane çok hızlı open+close edilirse WebglAddon._renderer henüz initialize
  // olmadan dispose tetiklenir. addon kodu `this._renderer._isDisposed` okumaya
  // çalışır ve Promise içinde TypeError fırlatır (try/catch async olduğu için
  // yakalayamaz). Mock obje yerleştirerek dispose chain'in sessizce tamamlanmasını
  // sağlıyoruz — memory leak yok çünkü sadece undefined ise mock koyuyoruz.
  if (webgl) {
    const w = webgl as unknown as { _renderer?: { dispose: () => void; _isDisposed: boolean } };
    if (!w._renderer) {
      w._renderer = { dispose: () => { /* noop */ }, _isDisposed: true };
    }
  }
  webgl = null;
  canvas = null;
  search = null;
  serialize = null;
  fit = null;
  // Mock sayesinde term.dispose() artık güvenli; yine de defansif try/catch.
  try { term?.dispose(); } catch (e) { console.warn('xterm dispose:', e); }
  term = null;
});

/** xterm cell metric'i font/tema/renderer değişiminde anında stabilize olmaz —
 *  WebGL addon özellikle DOM layout'a bağlı. nextTick + microtask yield, yeni
 *  metric hesaplandıktan sonra fit() çağrısının doğru cols/rows hesaplamasını
 *  garantiler. setTimeout(0) bazı sürümlerde extra güvence. */
async function refit() {
  await nextTick();
  setTimeout(() => handleResize(), 0);
}

// Tema değişiminde xterm tema güncelle (cell metric'i tema değiştirmez ama
// font fallback chain bir yerde değişirse fit lazım — refit güvenli)
watch(
  () => themeStore.active,
  (next) => {
    if (term && next) {
      term.options.theme = xtermThemeOf(next);
      refit();
    }
  },
);

watch(
  () => [settings.state.fontFamily, settings.state.fontSize] as const,
  ([family, size]) => {
    if (term) {
      term.options.fontFamily = buildFontFamily(family);
      term.options.fontSize = size;
      refit();
    }
  },
);

// Renderer değişiminde re-mount + refit
watch(() => settings.state.renderer, async (next) => {
  applyRenderer(next);
  await refit();
});

// Unicode 11 dinamik (yalnızca aktifleştirme — devre dışı bırakmak için reload gerek)
watch(() => settings.state.unicode11, (on) => {
  if (!term) return;
  if (on && term.unicode.activeVersion !== '11') {
    const u11 = new Unicode11Addon();
    try {
      term.loadAddon(u11);
      term.unicode.activeVersion = '11';
    } catch { /* zaten yüklü olabilir */ }
  } else if (!on) {
    term.unicode.activeVersion = '6';
  }
});

/** Tam temizlik: hem görünür ekran hem scrollback. PaneSlot context menu
 *  bu metodu çağırır — `\x0c` form feed yerine xterm native API. */
function clearTerminal() {
  // term.clear(): görünür satırları korur ama scrollback'i sıfırlar
  // → kullanıcı clear isterken hepsini sıfırla → reset() benzeri
  if (!term) return;
  term.clear();
  // term.clear() prompt satırını korur ama bazı bash/pwsh kombinasyonlarında
  // ek bir CR yardımcı olur — yine de form feed göndermiyoruz, scrollback temiz.
}

/** xterm native getSelection — WebGL/canvas/DOM her renderer'da güvenli.
 *  PaneSlot.copySelection bu metodu çağırır. */
function getSelection(): string {
  return term?.getSelection() ?? '';
}

defineExpose({ openSearch, copyBuffer, clearTerminal, getSelection });
</script>

<template>
  <div class="terminal-host" @keydown="onContainerKeydown">
    <div ref="container" class="terminal" />

    <!-- Inline autocomplete chip — history'den prefix-match öneri.
         → veya Tab ile kabul, başka tuşa basınca güncellenir. -->
    <div v-if="suggestion" class="suggest-chip" :title="t('terminal.suggest.hint')">
      <span class="suggest-chip__arrow">→</span>
      <code class="suggest-chip__text">{{ suggestion }}</code>
      <span class="suggest-chip__key">⇥</span>
    </div>

    <!-- Search overlay (Ctrl+F) — every modern terminal has this -->
    <div v-if="searchOpen" class="search-bar" @keydown.stop>
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        class="search-bar__input"
        :placeholder="t('terminal.search.placeholder')"
        spellcheck="false"
        @keydown="onSearchKey"
        @input="findNextDebounced"
      />
      <span class="search-bar__count">
        <template v-if="searchResultCount && searchResultCount.resultCount > 0">
          {{ searchResultCount.resultIndex + 1 }} / {{ searchResultCount.resultCount }}
        </template>
        <template v-else-if="searchQuery">
          {{ t('terminal.search.noMatch') }}
        </template>
      </span>
      <button
        type="button"
        :class="{ active: searchCaseSensitive }"
        :title="t('terminal.search.caseSensitive')"
        @click="searchCaseSensitive = !searchCaseSensitive; findNext()"
      >
Aa
</button>
      <button
        type="button"
        :class="{ active: searchWholeWord }"
        :title="t('terminal.search.wholeWord')"
        @click="searchWholeWord = !searchWholeWord; findNext()"
      >
ab|
</button>
      <button
        type="button"
        :class="{ active: searchRegex }"
        :title="t('terminal.search.regex')"
        @click="searchRegex = !searchRegex; findNext()"
      >
.*
</button>
      <button type="button" :title="t('terminal.search.prev')" @click="findPrev">↑</button>
      <button type="button" :title="t('terminal.search.next')" @click="findNext">↓</button>
      <button type="button" class="close" :title="t('common.close')" @click="closeSearch">×</button>
    </div>
  </div>
</template>

<style scoped>
.terminal-host {
  position: relative;
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}
.terminal {
  flex: 1;
  min-width: 0;
  min-height: 0;
  /* Transparent — xterm kendi tema bg'sini render eder; alttan window vibrancy görünür */
  background: transparent;
  padding: 4px;
}
:deep(.xterm) {
  height: 100%;
}
:deep(.xterm-viewport) {
  background-color: transparent !important;
}
:deep(.xterm-screen) {
  background-color: transparent !important;
}

/* --- Search overlay --- */
.search-bar {
  position: absolute;
  top: 6px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: rgba(10, 14, 26, 0.95);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  z-index: 30;
  backdrop-filter: blur(8px);
}
.search-bar__input {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid var(--color-line);
  color: var(--color-fg);
  padding: 3px 8px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
  width: 220px;
  outline: none;
}
.search-bar__input:focus {
  border-color: var(--color-accent);
}
.search-bar__count {
  font-size: 10px;
  color: var(--color-dim);
  min-width: 50px;
  text-align: center;
}
.search-bar button {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
}
.search-bar button:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.search-bar button.active {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}
.search-bar .close:hover {
  color: var(--color-red);
  border-color: var(--color-red);
}

/* Inline autocomplete chip — alt-sağda sticky, terminal cursor'una müdahale yok */
.suggest-chip {
  position: absolute;
  bottom: 6px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  background: rgba(10, 14, 26, 0.85);
  border: 1px solid var(--color-line);
  border-left: 2px solid var(--color-accent);
  border-radius: 3px;
  font-family: var(--font-family);
  font-size: 10px;
  color: var(--color-dim);
  pointer-events: none;
  z-index: 25;
  max-width: 60%;
  backdrop-filter: blur(6px);
}
.suggest-chip__arrow {
  color: var(--color-accent);
  font-weight: 700;
}
.suggest-chip__text {
  color: var(--color-fg);
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}
.suggest-chip__key {
  color: var(--color-accent);
  background: rgba(0, 180, 216, 0.15);
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
}
</style>
