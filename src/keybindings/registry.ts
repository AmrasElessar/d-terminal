// Keybinding registry — DOM seviyesinde tek dinleyici.
//
// `register(id, handler)` ile action handler'ı bağlanır; combo defaults'tan veya
// kullanıcı override'ından çözülür. Çakışma tespiti var.

import { DEFAULT_SHORTCUTS, type ShortcutDef } from './defaults';

type Handler = (e: KeyboardEvent) => void;

export class KeybindingRegistry {
  private bindings = new Map<string, ShortcutDef>(); // id → def
  private handlers = new Map<string, Handler>();     // id → handler
  private comboToId = new Map<string, string>();     // combo → id (lookup)
  private listener?: (e: KeyboardEvent) => void;

  constructor() {
    for (const def of DEFAULT_SHORTCUTS) {
      this.bindings.set(def.id, def);
      this.comboToId.set(def.combo.toLowerCase(), def.id);
    }
  }

  register(id: string, handler: Handler) {
    this.handlers.set(id, handler);
  }

  unregister(id: string) {
    this.handlers.delete(id);
  }

  getCombo(id: string): string | undefined {
    return this.bindings.get(id)?.combo;
  }

  getAll(): ShortcutDef[] {
    return Array.from(this.bindings.values());
  }

  /** Override the combo for an action. Returns conflicting id if any. */
  setCombo(id: string, combo: string): string | null {
    const normalized = combo.toLowerCase();
    const existing = this.comboToId.get(normalized);
    if (existing && existing !== id) return existing;
    const def = this.bindings.get(id);
    if (!def) return null;
    // Eski combo'yu temizle
    this.comboToId.delete(def.combo.toLowerCase());
    def.combo = combo;
    this.comboToId.set(normalized, id);
    return null;
  }

  attach() {
    if (this.listener) return;
    this.listener = (e: KeyboardEvent) => {
      const combo = comboOfEvent(e);
      if (!combo) return;
      const id = this.comboToId.get(combo);
      if (!id) return;
      const handler = this.handlers.get(id);
      if (!handler) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', this.listener);
  }

  detach() {
    if (this.listener) {
      window.removeEventListener('keydown', this.listener);
      this.listener = undefined;
    }
  }
}

function comboOfEvent(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  let key = e.key;
  if (key === ' ') key = 'Space';
  // Modifier'ı yalnız basıldıysa combo değil
  if (key === 'Control' || key === 'Alt' || key === 'Shift' || key === 'Meta') return null;
  // Tab gibi özel tuşları olduğu gibi kullan; harfleri uppercase yap (kısayollar case-insensitive)
  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join('+').toLowerCase();
}

export const keybindings = new KeybindingRegistry();
