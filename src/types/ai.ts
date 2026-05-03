export type ProviderId = 'anthropic' | 'ollama' | 'openai' | 'gemini' | 'custom';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Sadece assistant mesajlarında doldurulur — yanıtı üreten model id'si. */
  model?: string;
  /** Hangi provider yanıtladı. Multi-pane karşılaştırmalarda kullanışlı. */
  provider?: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
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
