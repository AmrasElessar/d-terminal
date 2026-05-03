// Varsayılan klavye kısayolları (architecture-v1.1.md §15).
//
// id → ('Ctrl+Shift+T' biçimi). Çakışma kontrolü registry tarafında.

export interface ShortcutDef {
  id: string;
  combo: string;
  /** i18n key — UI'da gösterilecek isim. */
  labelKey: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  // Tab kısayolları (browser standardı)
  { id: 'tab.new',             combo: 'Ctrl+T',        labelKey: 'tab.new' },
  { id: 'tab.close',           combo: 'Ctrl+W',        labelKey: 'tab.close' },
  { id: 'tab.next',            combo: 'Ctrl+Tab',      labelKey: 'tab.next' },
  { id: 'tab.prev',            combo: 'Ctrl+Shift+Tab', labelKey: 'tab.prev' },
  // Pane kısayolları (Shift'li versiyonlar pane odaklı)
  { id: 'pane.new',            combo: 'Ctrl+Shift+T', labelKey: 'pane.new' },
  { id: 'pane.close',          combo: 'Ctrl+Shift+W', labelKey: 'pane.close' },
  { id: 'pane.splitHorizontal', combo: 'Ctrl+Shift+\\', labelKey: 'pane.splitHorizontal' },
  { id: 'pane.splitVertical',  combo: 'Ctrl+Shift+-',  labelKey: 'pane.splitVertical' },
  { id: 'pane.focusNext',      combo: 'Alt+]',         labelKey: 'pane.focusNext' },
  { id: 'pane.focusPrev',      combo: 'Alt+[',         labelKey: 'pane.focusPrev' },
  { id: 'pane.maximize',       combo: 'Ctrl+Shift+Z',  labelKey: 'pane.maximize' },
  { id: 'ai.openPane',         combo: 'Ctrl+Shift+A',  labelKey: 'ai.title' },
  { id: 'ai.suggestCommand',   combo: 'Ctrl+Shift+G',  labelKey: 'ai.suggest.title' },
  { id: 'session.save',        combo: 'Ctrl+Shift+S',  labelKey: 'session.save' },
  { id: 'session.load',        combo: 'Ctrl+Shift+O',  labelKey: 'session.load' },
  { id: 'history.search',      combo: 'Ctrl+Shift+F',  labelKey: 'history.search' },
  { id: 'commandPalette.open', combo: 'Ctrl+Shift+P',  labelKey: 'commandPalette.placeholder' },
  { id: 'settings.open',       combo: 'Ctrl+Shift+,',  labelKey: 'settings.title' },
  { id: 'dfetch.run',          combo: 'Ctrl+Shift+D',  labelKey: 'dfetch.title' },
  { id: 'app.fullscreen',      combo: 'F11',           labelKey: 'app.title' },
  { id: 'app.devTools',        combo: 'Ctrl+Shift+I',  labelKey: 'app.title' },
  { id: 'app.about',           combo: 'Ctrl+Shift+/',  labelKey: 'about.title' },
  { id: 'panes.broadcastToggle', combo: 'Ctrl+Shift+B', labelKey: 'statusBar.broadcastHint' },
];
