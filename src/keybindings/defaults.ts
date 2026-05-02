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
  { id: 'pane.new',            combo: 'Ctrl+Shift+T', labelKey: 'pane.new' },
  { id: 'pane.close',          combo: 'Ctrl+Shift+W', labelKey: 'pane.close' },
  { id: 'pane.splitHorizontal', combo: 'Ctrl+Shift+\\', labelKey: 'pane.splitHorizontal' },
  { id: 'pane.splitVertical',  combo: 'Ctrl+Shift+-',  labelKey: 'pane.splitVertical' },
  { id: 'pane.focusNext',      combo: 'Ctrl+Tab',      labelKey: 'pane.focusNext' },
  { id: 'pane.focusPrev',      combo: 'Ctrl+Shift+Tab', labelKey: 'pane.focusPrev' },
  { id: 'pane.maximize',       combo: 'Ctrl+Shift+Z',  labelKey: 'pane.maximize' },
  { id: 'ai.openPane',         combo: 'Ctrl+Shift+A',  labelKey: 'ai.title' },
  { id: 'session.save',        combo: 'Ctrl+Shift+S',  labelKey: 'session.save' },
  { id: 'session.load',        combo: 'Ctrl+Shift+O',  labelKey: 'session.load' },
  { id: 'history.search',      combo: 'Ctrl+Shift+F',  labelKey: 'history.search' },
  { id: 'commandPalette.open', combo: 'Ctrl+Shift+P',  labelKey: 'commandPalette.placeholder' },
  { id: 'settings.open',       combo: 'Ctrl+Shift+,',  labelKey: 'settings.title' },
  { id: 'dfetch.run',          combo: 'Ctrl+Shift+D',  labelKey: 'dfetch.title' },
  { id: 'app.fullscreen',      combo: 'F11',           labelKey: 'app.title' },
];
