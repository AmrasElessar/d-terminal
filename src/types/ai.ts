import type { UsageEstimate } from '@/types/aiPricing';

export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  // Yerel AI runtime'ları (kullanıcı kendi makinesinde çalıştırır)
  | 'ollama'
  | 'lmstudio'
  | 'jan'
  | 'llamacpp'
  | 'foundry'
  // Esnek slot — kullanıcı kendi OpenAI-uyumlu endpoint'ini girer
  | 'custom';

/** Provider kategorisi — Settings UI'sında gruplama için. */
export type ProviderCategory = 'cloud' | 'local' | 'custom';

export const PROVIDER_CATEGORY: Record<ProviderId, ProviderCategory> = {
  anthropic: 'cloud',
  openai:    'cloud',
  gemini:    'cloud',
  ollama:    'local',
  lmstudio:  'local',
  jan:       'local',
  llamacpp:  'local',
  foundry:   'local',
  custom:    'custom',
};

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Sadece assistant mesajlarında doldurulur — yanıtı üreten model id'si. */
  model?: string;
  /** Hangi provider yanıtladı. Multi-pane karşılaştırmalarda kullanışlı. */
  provider?: string;
  /** Token + maliyet tahmini (frontend heuristik; exact usage Rust stream'inde
   *  henüz yok). Stream tamamlandıktan sonra hesaplanır. */
  usage?: UsageEstimate;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** OpenAI-uyumlu provider için endpoint override (custom provider zorunlu;
   *  yerel runtime'larda kullanıcı default port'u değiştirmek istediğinde). */
  endpoint?: string;
  /** Provider kesin token raporu (Anthropic message_delta, OpenAI
   *  stream_options.include_usage, Ollama done frame) — yoksa caller
   *  estimateTokens ile tahmine düşer. */
  onUsage?: (usage: { input: number; output: number }) => void;
}

export interface AIModel {
  id: string;
  label: string;
  contextWindow?: number;
  supportsStreaming?: boolean;
}

export interface AIProvider {
  id: ProviderId;
  name: string;
  /** Streaming chat — her chunk delta string. */
  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string>;
  /** Statik veya runtime model listesi. */
  models(): Promise<AIModel[]>;
  /** Key + bağlantı kontrolü. */
  isAvailable(): Promise<boolean>;
}

export interface ProviderConfig {
  id: ProviderId;
  endpoint?: string;
  defaultModel?: string;
}
