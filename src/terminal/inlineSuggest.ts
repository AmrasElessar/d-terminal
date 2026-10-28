// Inline autocomplete (fish/Warp tarzı) — geçmişten frecency ile öneri.
//
// Yarış koruması: her istek bir token alır; cevap geldiğinde token güncel
// değilse (kullanıcı bu arada Enter'a bastı, yazmaya devam etti) veya prefix
// değiştiyse sonuç atılır. Aksi halde eski öneri bir sonraki boş prompt'ta
// → ile kabul edilip önceki komutun tamamını yazıyordu.

import { ref, type Ref } from 'vue';
import type { HistoryEntry } from '@/types/history';

const HALF_LIFE_HOURS = 168;

/** Frecency: frequency × exp(-ageHours/halfLife) × favoriteBonus.
 *  Prefix ile başlamayan veya prefix'e eşit olan girdiler elenir. */
export function pickBestSuggestion(
  results: Pick<HistoryEntry, 'command' | 'executedAt' | 'isFavorite'>[],
  prefix: string,
  now = Date.now(),
): string | null {
  type Group = { freq: number; lastSeen: number; favorite: boolean };
  const groups = new Map<string, Group>();
  for (const h of results) {
    if (!h.command.startsWith(prefix) || h.command.length === prefix.length) continue;
    // Çok satırlı komutlar inline öneriye uygun değil (Enter içerir)
    if (/[\r\n]/.test(h.command)) continue;
    const ts = Date.parse(h.executedAt);
    if (Number.isNaN(ts)) continue;
    const g = groups.get(h.command);
    if (g) {
      g.freq++;
      if (ts > g.lastSeen) g.lastSeen = ts;
      if (h.isFavorite) g.favorite = true;
    } else {
      groups.set(h.command, { freq: 1, lastSeen: ts, favorite: h.isFavorite });
    }
  }
  let best: { command: string; score: number } | null = null;
  for (const [command, g] of groups) {
    const ageHours = Math.max(0, (now - g.lastSeen) / 36e5);
    const score = g.freq * Math.exp(-ageHours / HALF_LIFE_HOURS) * (g.favorite ? 2 : 1);
    if (!best || score > best.score) best = { command, score };
  }
  return best?.command ?? null;
}

export interface InlineSuggest {
  suggestion: Ref<string | null>;
  /** Buffer değişti — debounce ile yeni öneri iste. */
  schedule(): void;
  /** Öneriyi temizle ve uçuştaki isteği geçersiz kıl. */
  clear(): void;
  /** Öneri hâlâ geçerliyse kabul edilecek suffix'i döndür. */
  acceptableSuffix(buffer: string): string | null;
  dispose(): void;
}

export function createInlineSuggest(opts: {
  enabled: () => boolean;
  /** Güncel komut satırı tamponu; null = bilinmiyor (öneri yok). */
  buffer: () => string | null;
  search: (prefix: string) => Promise<HistoryEntry[]>;
  debounceMs?: number;
}): InlineSuggest {
  const suggestion = ref<string | null>(null);
  let timer: number | undefined;
  let token = 0;

  async function refresh(myToken: number) {
    const buf = opts.buffer();
    if (!opts.enabled() || buf === null) {
      suggestion.value = null;
      return;
    }
    const prefix = buf.trim();
    if (prefix.length < 2 || prefix !== buf) {
      // Baştaki boşluk = private komut (geçmişe yazılmaz) — öneri de yok
      suggestion.value = null;
      return;
    }
    try {
      const results = await opts.search(prefix);
      if (myToken !== token) return;
      if (opts.buffer() !== buf) return;
      suggestion.value = pickBestSuggestion(results, prefix);
    } catch {
      if (myToken === token) suggestion.value = null;
    }
  }

  function clear() {
    token++;
    suggestion.value = null;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  return {
    suggestion,
    schedule() {
      if (timer !== undefined) window.clearTimeout(timer);
      const myToken = ++token;
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh(myToken);
      }, opts.debounceMs ?? 80);
    },
    clear,
    acceptableSuffix(buffer: string) {
      const s = suggestion.value;
      if (!s || !buffer || !s.startsWith(buffer)) return null;
      const suffix = s.slice(buffer.length);
      return suffix || null;
    },
    dispose: clear,
  };
}
