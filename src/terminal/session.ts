// TerminalSession — pane başına xterm + PTY yaşam döngüsü, Vue komponentinden
// bağımsız.
//
// Neden: Vue komponenti tab değişiminde, zoom (maximize) modunda ve split
// ağacı yeniden düzenlendiğinde unmount/remount oluyor. Eskiden stdout
// listener'ı unmount'ta kapanıyor, arka plandaki pane'in çıktısı (derleme
// logu vb.) kayboluyor, trigger/block/agent algılama duruyor ve remount'ta
// serialize snapshot'ı ile terminal modları (alt buffer, bracketed paste,
// app-cursor) düşüyordu.
//
// Şimdi: Terminal örneği ve PTY dinleyicisi pane kapanana kadar yaşar.
// Komponent mount'ta session'ın host `<div>`'ini kendi container'ına taşır
// (`attach`), unmount'ta söker (`detach`). xterm görünmezken de yazmaya devam
// eder; tüm durum (scrollback, modlar, alt screen) korunur.

import { effectScope, ref, watch, type Ref } from 'vue';
import { Terminal, type IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { CanvasAddon } from '@xterm/addon-canvas';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';
import { api } from '@/api/tauri';
import { PANE_FONT_MAX, PANE_FONT_MIN, type LeafNode, type PaneType } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';
import { useThemeStore } from '@/stores/theme';
import { useSettingsStore, type RendererMode } from '@/stores/settings';
import { useToastsStore } from '@/stores/toasts';
import { useProfilesStore } from '@/stores/profiles';
import { useTriggersStore } from '@/stores/triggers';
import { useAgentWatchStore } from '@/stores/agentWatch';
import { xtermThemeOf } from '@/themes/apply';
import {
  createBlockTracker,
  registerBlockTracker,
  unregisterBlockTracker,
  type BlockTracker,
} from '@/composables/useBlocks';
import { createSmartLinkProvider } from '@/composables/useSmartLinks';
import {
  feedAgentDetector,
  feedAgentDetectorChunk,
  clearAgentDetectorState,
} from '@/composables/useAgentDetector';
import { setPaneCwd, startGitStatPolling, clearGitStatState } from '@/composables/useGitStat';
import { useModals } from '@/composables/useModals';
import { builtinShellInitArgs } from '@/shellInit';
import { formatError } from '@/utils/error';
import { stripAnsi } from '@/utils/ansi';
import { openExternalUrl } from '@/utils/openExternal';
import { confirmAsk } from '@/utils/dialog';
import { keybindings } from '@/keybindings/registry';
import { tGlobal as t } from '@/i18n';
import { createPtyStream } from './ptyStream';
import { createInlineSuggest } from './inlineSuggest';
import { createLineFeeder, installShellIntegration } from './shellIntegration';
import { lineCountOf, preparePaste } from './paste';
import { getTerminalSession, registerTerminalSession } from './registry';

export interface SearchResults {
  resultIndex: number;
  resultCount: number;
}

export interface TerminalSession {
  readonly leafId: string;
  readonly suggestion: Ref<string | null>;
  readonly scrollMode: Ref<boolean>;
  readonly searchResults: Ref<SearchResults | null>;
  readonly blocks: BlockTracker;
  /** Komponent hook'ları — Ctrl+F gibi UI'a ait tuşlar. */
  ui: { openSearch?: () => void };
  attach(el: HTMLElement): void;
  detach(): void;
  focus(): void;
  findNext(query: string, opts: ISearchOptions): void;
  findPrevious(query: string, opts: ISearchOptions): void;
  clearSearch(): void;
  copyBuffer(): void;
  clearTerminal(): void;
  getSelection(): string;
  sendSigint(): void;
  /** Alternate screen (vim, less, htop) aktif mi. */
  isAltBuffer(): boolean;
  bracketedPaste(): boolean;
  dispose(): void;
}

function buildFontFamily(primary: string): string {
  return `"${primary}", "Cascadia Code", "Cascadia Mono", "Consolas", "Courier New", monospace`;
}

function safeDispose(addon: { dispose(): void } | null) {
  if (!addon) return;
  try {
    addon.dispose();
  } catch {
    /* zaten dispose edilmiş olabilir */
  }
}

export function getOrCreateTerminalSession(leafId: string): TerminalSession {
  const existing = getTerminalSession<TerminalSession>(leafId);
  if (existing) return existing;
  const s = createTerminalSession(leafId);
  registerTerminalSession(leafId, s);
  return s;
}

function createTerminalSession(leafId: string): TerminalSession {
  const panes = usePanesStore();
  const themeStore = useThemeStore();
  const settings = useSettingsStore();
  const toasts = useToastsStore();
  const profiles = useProfilesStore();
  const triggers = useTriggersStore();
  const agentWatch = useAgentWatchStore();
  const modals = useModals();

  const leaf = (): LeafNode | null => panes.getLeaf(leafId);
  const scope = effectScope(true);
  const disposables: IDisposable[] = [];
  let disposed = false;
  let opened = false;
  let spawnStarted = false;

  const host = document.createElement('div');
  host.className = 'terminal-session-host';
  host.style.width = '100%';
  host.style.height = '100%';

  const scrollMode = ref(false);
  const searchResults = ref<SearchResults | null>(null);

  const effectiveFontSize = () => {
    const base = settings.state.fontSize;
    const offset = leaf()?.fontSizeOffset ?? 0;
    return Math.max(PANE_FONT_MIN, Math.min(PANE_FONT_MAX, base + offset));
  };

  const term = new Terminal({
    fontFamily: buildFontFamily(settings.state.fontFamily),
    fontSize: effectiveFontSize(),
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: settings.state.scrollback,
    theme: themeStore.active ? xtermThemeOf(themeStore.active) : undefined,
    allowProposedApi: true,
    lineHeight: 1.2,
    letterSpacing: 0,
    screenReaderMode: settings.state.screenReaderMode,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  const serialize = new SerializeAddon();
  let webgl: WebglAddon | null = null;
  let canvas: CanvasAddon | null = null;
  term.loadAddon(fit);
  // Varsayılan WebLinksAddon handler'ı `window.open` kullanır → WebView2
  // içinde saldırgan URL'i uygulama penceresinde açılırdı. Yalnızca http(s),
  // sistem tarayıcısında.
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault();
      void openExternalUrl(uri);
    }),
  );
  // @xterm/addon-image yüklenmiyor: hem sixel hem iTerm2 inline image (IIP)
  // decoder'ı WebAssembly kullanır ve production CSP'de 'wasm-unsafe-eval'
  // yok (CSP sıkılaştırması). Inline görsel desteği bu yüzden kapalı.
  term.loadAddon(search);
  term.loadAddon(serialize);
  if (settings.state.unicode11) {
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
  }
  disposables.push(search.onDidChangeResults((evt) => (searchResults.value = evt)));

  const blocks = createBlockTracker();
  registerBlockTracker(leafId, blocks);

  // --- komut tamponu + inline öneri ---
  /** Komut satırı tamponu; null = bilinmiyor (geçmiş gezinmesi, TUI vb.). */
  let cmdBuffer: string | null = '';
  const isAltBuffer = () => term.buffer.active.type === 'alternate';
  const suggest = createInlineSuggest({
    enabled: () => settings.state.inlineAutocomplete && !isAltBuffer(),
    buffer: () => cmdBuffer,
    search: (prefix) => api.historySearch({ text: prefix, limit: 200 }),
  });
  function resetCmdBuffer() {
    cmdBuffer = '';
    suggest.clear();
  }

  // --- çıktı: xterm + block + trigger + agent detector ---
  const lineFeeder = createLineFeeder({
    onChunk: (stripped) => {
      if (settings.state.agentHeuristicEnabled) feedAgentDetectorChunk(stripped, leafId);
    },
    onLine: (line) => {
      const l = leaf();
      triggers.matchLine(line, leafId, l?.type ?? 'all');
      if (settings.state.agentHeuristicEnabled) feedAgentDetector(line, leafId);
    },
  });
  const stream = createPtyStream((bytes, text) => {
    if (disposed) return;
    term.write(bytes);
    blocks.onOutput(text);
    lineFeeder.feed(text);
  });

  disposables.push(
    ...installShellIntegration(term, {
      blocks,
      onPromptBoundary: resetCmdBuffer,
      onCommandFinished: (command, exitCode, durationMs) => {
        const l = leaf();
        api
          .historyAdd({ command, paneId: leafId, paneType: l?.type, exitCode, durationMs })
          .catch(() => {
            /* offline / migration sırasında yutulur */
          });
      },
      onCwd: (path) => setPaneCwd(leafId, path),
      onAgentEvent: (ev) => agentWatch.dispatch(leafId, ev),
    }),
  );

  // --- input ---
  function writeToPty(data: string | Uint8Array) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (panes.broadcastInput) {
      // Aktif tab'daki tüm çalışan terminal pane'lerine (tmux sync-panes)
      for (const l of panes.allLeaves) {
        if (l.ptyId && l.status === 'running') api.ptyWrite(l.ptyId, bytes).catch(() => {});
      }
      return;
    }
    const ptyId = leaf()?.ptyId;
    if (ptyId) api.ptyWrite(ptyId, bytes).catch(() => {});
  }

  function atPrompt(): boolean {
    return !isAltBuffer() && cmdBuffer !== null;
  }

  disposables.push(
    term.onData((data) => {
      if (!leaf()?.ptyId) return;
      const alt = isAltBuffer();

      // `#` interception (Warp Agent Mode): yalnızca normal ekranda, boş
      // komut satırında. vim/less içinde `#` her zaman uygulamaya gider.
      if (settings.state.aiPrefixHash && data === '#' && cmdBuffer === '' && atPrompt()) {
        panes.focus(leafId);
        modals.open('aiSuggest');
        return;
      }

      // Inline öneri kabulü: yalnızca → (Tab shell completion'a kalır),
      // yalnızca prompt'ta ve öneri hâlâ tampona uyuyorsa.
      if (data === '\x1b[C' && cmdBuffer !== null && atPrompt()) {
        const suffix = suggest.acceptableSuffix(cmdBuffer);
        if (suffix) {
          writeToPty(suffix);
          cmdBuffer += suffix;
          suggest.clear();
          blocks.onUserInput(suffix, { altBuffer: alt });
          return;
        }
      }

      // Tampon güncelleme
      if (alt) {
        cmdBuffer = null;
        suggest.clear();
      } else if (data.includes('\r') || data.includes('\n') || data === '\x03') {
        // Enter / Ctrl+C — satır bitti; yeni prompt (OSC 133 A/B) gelene kadar
        // shell'in ne yazdığını bilmiyoruz.
        cmdBuffer = data === '\x03' ? '' : null;
        suggest.clear();
        // OSC 133 desteklemeyen shell'lerde (cmd.exe) prompt sinyali gelmez —
        // Enter sonrası tamponu boş kabul et.
        if (!blocks.hasShellIntegration()) cmdBuffer = '';
      } else if (data === '\x7f' || data === '\b') {
        if (cmdBuffer !== null) {
          cmdBuffer = cmdBuffer.slice(0, -1);
          suggest.schedule();
        }
      } else if (data.charCodeAt(0) === 0x1b || data === '\t') {
        // Ok tuşları, geçmiş gezinmesi, Esc, Tab completion — shell satırı
        // bizim göremediğimiz şekilde değiştirir.
        cmdBuffer = null;
        suggest.clear();
      } else if (cmdBuffer !== null && data.length >= 1 && data.charCodeAt(0) >= 32) {
        cmdBuffer += data;
        suggest.schedule();
      }

      blocks.onUserInput(data, { altBuffer: alt });
      writeToPty(data);
    }),
  );

  // Resize IPC debounce — divider sürüklerken her frame PTY'ye boyut
  // göndermek PowerShell prompt'unu defalarca yeniden çizdiriyordu.
  let resizeIpcTimer = 0;
  disposables.push(
    term.onResize(({ cols, rows }) => {
      const ptyId = leaf()?.ptyId;
      if (!ptyId) return;
      if (resizeIpcTimer) clearTimeout(resizeIpcTimer);
      resizeIpcTimer = window.setTimeout(() => {
        resizeIpcTimer = 0;
        api.ptyResize(ptyId, cols, rows).catch(() => {});
      }, 120);
    }),
  );
  disposables.push(
    term.onTitleChange((title) => {
      if (title && title.length > 0) panes.setLeafState(leafId, { title: title.slice(0, 256) });
    }),
  );

  // --- paste ---
  async function handlePaste(): Promise<void> {
    if (!leaf()?.ptyId) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      toasts.error(t('terminal.pasteFailed', { error: String(e) }));
      return;
    }
    if (!text || disposed) return;
    const lines = lineCountOf(text.replace(/[\r\n]+$/, ''));
    const bracketed = term.modes.bracketedPasteMode;
    // Bracketed paste yoksa (cmd.exe) her satır anında çalışır — önce onay al.
    if (!bracketed && lines > 1) {
      const ok = await confirmAsk(t('terminal.pasteConfirm', { count: lines }), {
        kind: 'warning',
        confirmLabel: t('terminal.pasteConfirmAction'),
      });
      if (!ok || disposed) return;
    }
    writeToPty(preparePaste(text, bracketed));
    if (lines > 1 && bracketed) toasts.info(t('terminal.pastedBracketed', { count: lines }), 1800);
  }

  // --- tuş yönetimi ---
  function handleScrollModeKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      scrollMode.value = false;
      return true;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return false;
    switch (e.key) {
      case 'j': case 'ArrowDown': term.scrollLines(1); return true;
      case 'k': case 'ArrowUp': term.scrollLines(-1); return true;
      case 'd': case 'PageDown': term.scrollPages(0.5); return true;
      case 'u': case 'PageUp': term.scrollPages(-0.5); return true;
      case 'g': case 'Home': term.scrollToTop(); return true;
      case 'G': case 'End': term.scrollToBottom(); return true;
      case 'y': case 'Y': {
        const sel = term.getSelection();
        if (sel) {
          copyText(sel, t('common.copy') + ' ✓');
          scrollMode.value = false;
        }
        return true;
      }
      case '/': session.ui.openSearch?.(); return true;
    }
    return true;
  }

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    // Ctrl+F → arama overlay
    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      session.ui.openSearch?.();
      return false;
    }
    // Ctrl+Shift+Space → scroll/copy modu
    if (event.ctrlKey && event.shiftKey && (event.code === 'Space' || event.key === ' ')) {
      event.preventDefault();
      scrollMode.value = !scrollMode.value;
      return false;
    }
    // Ctrl+V / Ctrl+Shift+V → güvenli paste
    if (event.ctrlKey && !event.altKey && event.code === 'KeyV') {
      event.preventDefault();
      void handlePaste();
      return false;
    }
    if (scrollMode.value) return !handleScrollModeKey(event);
    // Global kısayollar (Ctrl+T/W/Tab, Alt+[ ...): xterm tuşu tüketip
    // propagation'ı durdurduğu için window listener'ı hiç görmüyordu. false
    // dönünce xterm tuşu işlemez ve olay window'a kabarır.
    if (keybindings.handles(event)) return false;
    return true;
  });

  // --- renderer ---
  function applyRenderer(mode: RendererMode) {
    if (!opened) return;
    safeDispose(webgl);
    webgl = null;
    safeDispose(canvas);
    canvas = null;
    const tryWebgl = (): boolean => {
      try {
        const addon = new WebglAddon();
        addon.onContextLoss(() => {
          safeDispose(webgl);
          webgl = null;
          const c = new CanvasAddon();
          try {
            term.loadAddon(c);
            canvas = c;
          } catch {
            /* DOM fallback */
          }
        });
        term.loadAddon(addon);
        webgl = addon;
        return true;
      } catch {
        return false;
      }
    };
    const tryCanvas = (): boolean => {
      try {
        const addon = new CanvasAddon();
        term.loadAddon(addon);
        canvas = addon;
        return true;
      } catch {
        return false;
      }
    };
    switch (mode) {
      case 'webgl': tryWebgl() || tryCanvas(); break;
      case 'canvas': tryCanvas(); break;
      case 'dom': break;
      default: tryWebgl() || tryCanvas(); break;
    }
  }

  // --- resize ---
  let resizeRafId = 0;
  let observer: ResizeObserver | null = null;
  function handleResize() {
    if (resizeRafId || disposed) return;
    resizeRafId = requestAnimationFrame(() => {
      resizeRafId = 0;
      if (disposed || !host.isConnected) return;
      try {
        fit.fit();
      } catch {
        /* container görünür değilse atla */
      }
    });
  }
  function refit() {
    setTimeout(() => handleResize(), 0);
  }
  function onWheelZoom(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    panes.adjustFontSize(leafId, e.deltaY < 0 ? +1 : -1);
  }
  host.addEventListener('wheel', onWheelZoom, { capture: true, passive: false });

  // --- spawn ---
  function shellInitArgsFor(paneType: PaneType, isBuiltin: boolean): string[] {
    return isBuiltin ? builtinShellInitArgs(paneType) : [];
  }

  async function spawn() {
    if (spawnStarted || disposed) return;
    spawnStarted = true;
    const l = leaf();
    if (!l) return;
    try {
      fit.fit();
    } catch {
      /* ölçü yoksa varsayılan */
    }
    const { cols, rows } = term;
    // Listener spawn'dan ÖNCE — ilk çıktı kaybolmasın.
    await stream.start();
    if (disposed) return;

    // Leaf'te zaten canlı PTY varsa (ör. eski sürüm state'i) yeniden bağlan.
    if (l.ptyId && l.status === 'running') {
      stream.bind(l.ptyId);
      api.ptyResize(l.ptyId, cols, rows).catch(() => {});
      startGitStatPolling(leafId);
      return;
    }

    const profile = l.profileId ? profiles.find(l.profileId) : profiles.defaultFor(l.type);
    if (!profile) {
      panes.setLeafState(leafId, { status: 'idle' });
      return;
    }
    const initArgs = shellInitArgsFor(profile.paneType, profile.builtin);
    panes.setLeafState(leafId, { status: 'spawning' });
    let ptyId: string;
    try {
      ptyId = await api.ptySpawn({
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
    } catch (e: unknown) {
      if (!disposed) panes.setLeafState(leafId, { status: 'error', errorMessage: formatError(e) });
      return;
    }
    // Pane spawn sürerken kapatıldıysa: closePane henüz ptyId bilmediği için
    // öldüremedi — burada öldür, aksi halde yetim shell kalır.
    if (disposed || !leaf()) {
      api.ptyKill(ptyId).catch(() => {});
      return;
    }
    stream.bind(ptyId);
    panes.setLeafState(leafId, { ptyId, status: 'running' });
    if (profile.cwd && profile.cwd.length > 0) setPaneCwd(leafId, profile.cwd);
    startGitStatPolling(leafId);
  }

  // --- reaktif ayarlar ---
  scope.run(() => {
    watch(
      () => themeStore.active,
      (next) => {
        if (next) {
          term.options.theme = xtermThemeOf(next);
          refit();
        }
      },
    );
    watch(
      () => [settings.state.fontFamily, effectiveFontSize()] as const,
      ([family, size]) => {
        term.options.fontFamily = buildFontFamily(family);
        term.options.fontSize = size;
        refit();
      },
    );
    watch(
      () => settings.state.renderer,
      (next) => {
        applyRenderer(next);
        refit();
      },
    );
    watch(
      () => settings.state.unicode11,
      (on) => {
        if (on && term.unicode.activeVersion !== '11') {
          try {
            term.loadAddon(new Unicode11Addon());
            term.unicode.activeVersion = '11';
          } catch {
            /* zaten yüklü */
          }
        } else if (!on) {
          term.unicode.activeVersion = '6';
        }
      },
    );
    // Canlı uygulanan ayarlar (önceden yeniden başlatma gerekiyordu)
    watch(
      () => settings.state.scrollback,
      (n) => {
        if (Number.isFinite(n) && n >= 0) term.options.scrollback = n;
      },
    );
    watch(
      () => settings.state.screenReaderMode,
      (on) => {
        term.options.screenReaderMode = !!on;
      },
    );
  });

  function copyText(text: string, okMsg: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toasts.success(okMsg, 1200))
      .catch((e) => toasts.error(t('errors.clipboard', { error: String(e) })));
  }

  const session: TerminalSession = {
    leafId,
    suggestion: suggest.suggestion,
    scrollMode,
    searchResults,
    blocks,
    ui: {},
    attach(el: HTMLElement) {
      if (disposed) return;
      if (host.parentElement !== el) el.appendChild(host);
      if (!opened) {
        term.open(host);
        opened = true;
        applyRenderer(settings.state.renderer);
        term.registerLinkProvider(
          createSmartLinkProvider(term, {
            // PTY çıktısı saldırgan kontrolünde olabilir; shell scope'u yalnızca
            // http(s)/mailto açar — yollar her zaman panoya kopyalanır (tek tık
            // ile dosya/uygulama çalıştırma vektörü yok).
            onPath: (p) => copyText(p, t('terminal.pathCopied')),
            onGitRef: (sha) => copyText(sha, t('terminal.shaCopied', { sha: sha.slice(0, 8) })),
            onHost: (h) => copyText(h, t('terminal.hostCopied')),
          }),
        );
      } else {
        // Yeniden görünür oldu — gizliyken yazılanları çiz
        try {
          term.refresh(0, term.rows - 1);
        } catch {
          /* yut */
        }
      }
      observer?.disconnect();
      observer = new ResizeObserver(() => handleResize());
      observer.observe(el);
      window.addEventListener('resize', handleResize);
      handleResize();
      if (!spawnStarted) void spawn();
    },
    detach() {
      observer?.disconnect();
      observer = null;
      window.removeEventListener('resize', handleResize);
      if (resizeRafId) {
        cancelAnimationFrame(resizeRafId);
        resizeRafId = 0;
      }
      host.remove();
    },
    focus() {
      term.focus();
    },
    findNext(q, opts) {
      if (q) search.findNext(q, opts);
    },
    findPrevious(q, opts) {
      if (q) search.findPrevious(q, opts);
    },
    clearSearch() {
      search.clearDecorations();
      searchResults.value = null;
      term.focus();
    },
    copyBuffer() {
      const text = serialize.serialize({ excludeAltBuffer: true, excludeModes: true });
      copyText(stripAnsi(text), t('terminal.bufferCopied'));
    },
    clearTerminal() {
      term.clear();
    },
    getSelection() {
      return term.getSelection();
    },
    sendSigint() {
      const ptyId = leaf()?.ptyId;
      if (ptyId) api.ptyWrite(ptyId, new Uint8Array([0x03])).catch(() => {});
    },
    isAltBuffer,
    bracketedPaste: () => term.modes.bracketedPasteMode,
    dispose() {
      if (disposed) return;
      disposed = true;
      session.detach();
      host.removeEventListener('wheel', onWheelZoom, { capture: true } as EventListenerOptions);
      if (resizeIpcTimer) clearTimeout(resizeIpcTimer);
      stream.stop();
      suggest.dispose();
      lineFeeder.reset();
      scope.stop();
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* yut */
        }
      }
      unregisterBlockTracker(leafId);
      clearAgentDetectorState(leafId);
      clearGitStatState(leafId);
      // xterm-addon-webgl 0.19: renderer initialize olmadan dispose edilirse
      // Promise içinde TypeError fırlatır — mock renderer ile güvenli kapat.
      if (webgl) {
        const w = webgl as unknown as { _renderer?: { dispose: () => void; _isDisposed: boolean } };
        if (!w._renderer) w._renderer = { dispose: () => {}, _isDisposed: true };
      }
      webgl = null;
      canvas = null;
      try {
        term.dispose();
      } catch (e) {
        console.warn('xterm dispose:', e);
      }
    },
  };
  return session;
}
