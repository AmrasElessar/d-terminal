// Keybinding registry — DOM seviyesinde tek dinleyici.
//
// `register(id, handler)` ile action handler'ı bağlanır; combo defaults'tan veya
// kullanıcı override'ından çözülür. Çakışma tespiti var.
//
// Prefix mode (tmux tarzı): `setPrefix({combo, actions})` ile açılır.
// Combo'ya basıldığında 1 saniyelik modal moda girilir; sonraki ham karakter
// tuşu prefix action map'inde aranır, bulunursa action handler tetiklenir.
// Visual feedback için `prefixActive` ref'i dışarıdan watch edilebilir.

import { ref } from 'vue';
import { DEFAULT_SHORTCUTS, type ShortcutDef } from './defaults';

type Handler = (e: KeyboardEvent) => void;

const PREFIX_TIMEOUT_MS = 1000;

export class KeybindingRegistry {
  private bindings = new Map<string, ShortcutDef>(); // id → def
  private handlers = new Map<string, Handler>();     // id → handler
  private comboToId = new Map<string, string>();     // combo → id (lookup)
  private listener?: (e: KeyboardEvent) => void;

  // Prefix-mode (tmux tarzı modal kısayollar)
  private prefixCombo: string | null = null;
  private prefixActions = new Map<string, string>(); // key (lowercase) → action id
  private prefixTimer = 0;
  /** UI vurgu için: prefix modu aktif mi (overlay göstermek için). */
  readonly prefixActive = ref(false);

  constructor() {
    for (const def of DEFAULT_SHORTCUTS) {
      this.bindings.set(def.id, def);
      this.comboToId.set(def.combo.toLowerCase(), def.id);
    }
  }

  /** Prefix-mode konfigürasyonu — null combo veya boş action map = devre dışı. */
  setPrefix(combo: string | null, actions: Record<string, string>) {
    this.prefixCombo = combo ? combo.toLowerCase() : null;
    this.prefixActions.clear();
    for (const [k, v] of Object.entries(actions)) {
      this.prefixActions.set(k.toLowerCase(), v);
    }
    this.exitPrefix();
  }

  private enterPrefix() {
    this.prefixActive.value = true;
    if (this.prefixTimer) window.clearTimeout(this.prefixTimer);
    this.prefixTimer = window.setTimeout(() => this.exitPrefix(), PREFIX_TIMEOUT_MS);
  }

  private exitPrefix() {
    this.prefixActive.value = false;
    if (this.prefixTimer) {
      window.clearTimeout(this.prefixTimer);
      this.prefixTimer = 0;
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

      // Prefix mode aktifse: modifier'sız (sadece harf/rakam) tuşları yakala,
      // action map'te ara. Modifier'lı kombolarsa normal akışa düş — kullanıcı
      // prefix moddan çıkmak için Esc bassın.
      if (this.prefixActive.value && this.prefixCombo) {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.exitPrefix();
          return;
        }
        const isPlainKey = !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1;
        if (isPlainKey) {
          const actionId = this.prefixActions.get(e.key.toLowerCase());
          this.exitPrefix();
          if (actionId) {
            const handler = this.handlers.get(actionId);
            if (handler) {
              e.preventDefault();
              handler(e);
              return;
            }
          }
          // Tanınmayan tuş — prefix modu kapat, tuşu sessizce yut (terminale gitmesin).
          e.preventDefault();
          return;
        }
      }

      // Prefix combo eşleşti mi → moda gir
      if (this.prefixCombo && combo === this.prefixCombo) {
        e.preventDefault();
        this.enterPrefix();
        return;
      }

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
