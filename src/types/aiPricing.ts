// AI model fiyatları (Ocak 2026 itibarıyla, USD per 1M tokens).
// Provider API'leri stream içinde usage döndürse de Rust tarafına henüz
// extension yapılmadı — bu yüzden frontend'de heuristik token sayımı
// (~4 char/token) ile çalışıyoruz. UI'de "≈" prefix ile gösteriyoruz.

export interface ModelPrice {
  /** $/1M input tokens */
  inputPer1M: number;
  /** $/1M output tokens */
  outputPer1M: number;
}

/** Bilinen model fiyat tablosu. Bilinmeyen model id → tahmin yok ('—' göster). */
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic Claude (2025-2026)
  'claude-opus-4-7':         { inputPer1M: 15,   outputPer1M: 75   },
  'claude-opus-4-6':         { inputPer1M: 15,   outputPer1M: 75   },
  'claude-opus-4':           { inputPer1M: 15,   outputPer1M: 75   },
  'claude-sonnet-4-6':       { inputPer1M:  3,   outputPer1M: 15   },
  'claude-sonnet-4-5':       { inputPer1M:  3,   outputPer1M: 15   },
  'claude-sonnet-4':         { inputPer1M:  3,   outputPer1M: 15   },
  'claude-haiku-4-5':        { inputPer1M:  1,   outputPer1M:  5   },
  'claude-haiku-4-5-20251001': { inputPer1M:  1, outputPer1M:  5  },
  'claude-3-5-sonnet':       { inputPer1M:  3,   outputPer1M: 15   },
  'claude-3-5-haiku':        { inputPer1M:  0.8, outputPer1M:  4   },

  // OpenAI (2025-2026)
  'gpt-5':                   { inputPer1M:  3,   outputPer1M: 10   },
  'gpt-5-mini':              { inputPer1M:  0.6, outputPer1M:  2.4 },
  'gpt-4o':                  { inputPer1M:  2.5, outputPer1M: 10   },
  'gpt-4o-mini':             { inputPer1M:  0.15, outputPer1M: 0.6 },
  'o1':                      { inputPer1M: 15,   outputPer1M: 60   },
  'o1-mini':                 { inputPer1M:  3,   outputPer1M: 12   },

  // Google Gemini
  'gemini-2.5-pro':          { inputPer1M:  1.25, outputPer1M: 5   },
  'gemini-2.0-pro':          { inputPer1M:  1.25, outputPer1M: 5   },
  'gemini-2.0-flash':        { inputPer1M:  0.1,  outputPer1M: 0.4 },
  'gemini-2.0-flash-lite':   { inputPer1M:  0.075, outputPer1M: 0.3 },
  'gemini-1.5-pro':          { inputPer1M:  1.25, outputPer1M: 5   },
  'gemini-1.5-flash':        { inputPer1M:  0.075, outputPer1M: 0.3 },

  // Ollama — yerel, sıfır maliyet
  // (Tüm Ollama modelleri runtime'da pricing tablosunda 0 olarak işlenir,
  //  aşağıdaki anahtar fallback amaçlı — id provider-prefixed gelirse.)
};

/** Ollama prefix'i veya yerel model id'si — fiyatı 0 say. */
function isLocal(provider: string, modelId: string): boolean {
  if (provider === 'ollama') return true;
  if (modelId.startsWith('ollama/')) return true;
  return false;
}

export interface UsageEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null; // null = bilinmiyor (model fiyatı yok)
}

/** Heuristik token sayısı — 1 token ≈ 4 karakter. GPT/Claude tokenizer'ları
 *  için %15-25 hata payı var ama UI gösterimi için yeterli. Türkçe gibi
 *  morfolojik diller biraz fazla token kullanır; "≈" prefix bu belirsizliği
 *  kullanıcıya iletir. Exact usage Rust stream'inde implement edilince burası
 *  bypass edilir. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Boşluk/karakter karışımı için pragmatik ortalama
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Bir mesaj çiftinin (input prompt + output cevap) maliyetini hesapla. */
export function estimateCost(
  provider: string,
  modelId: string,
  inputText: string,
  outputText: string,
): UsageEstimate {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);

  if (isLocal(provider, modelId)) {
    return { inputTokens, outputTokens, costUsd: 0 };
  }

  const price = MODEL_PRICING[modelId];
  if (!price) {
    return { inputTokens, outputTokens, costUsd: null };
  }
  const costUsd =
    (inputTokens / 1_000_000) * price.inputPer1M +
    (outputTokens / 1_000_000) * price.outputPer1M;
  return { inputTokens, outputTokens, costUsd };
}

/** UI rozet formatı: "1.2k tok · ≈ $0.008" */
export function formatUsageBadge(u: UsageEstimate): string {
  const total = u.inputTokens + u.outputTokens;
  const tok = total < 1000 ? `${total} tok` : `${(total / 1000).toFixed(1)}k tok`;
  if (u.costUsd === null) return `≈ ${tok}`;
  if (u.costUsd === 0) return `${tok} · yerel`;
  if (u.costUsd < 0.001) return `≈ ${tok} · <$0.001`;
  if (u.costUsd < 1) return `≈ ${tok} · ≈ $${u.costUsd.toFixed(4)}`;
  return `≈ ${tok} · ≈ $${u.costUsd.toFixed(2)}`;
}

/** Toplam maliyet (oturum içi bir liste) */
export function sumUsage(items: UsageEstimate[]): UsageEstimate {
  const inputTokens = items.reduce((s, x) => s + x.inputTokens, 0);
  const outputTokens = items.reduce((s, x) => s + x.outputTokens, 0);
  let costUsd: number | null = 0;
  for (const u of items) {
    if (u.costUsd === null) {
      costUsd = null;
      break;
    }
    if (costUsd !== null) costUsd += u.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}
