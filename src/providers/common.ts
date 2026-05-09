// Frontend AI provider'ları için ortak Rust delegate katmanı.
//
// Tüm provider'lar Rust tarafındaki commands::ai::ai_chat_stream'i çağırır:
// API key DPAPI vault'tan alınır, HTTP ve SSE/NDJSON parse Rust'ta yapılır.
// Frontend hiçbir zaman plain key görmez.

import { invoke } from '@tauri-apps/api/core';
import { Channel } from '@tauri-apps/api/core';
import type { AIModel, ChatMessage, ChatOptions, ProviderId } from '@/types/ai';
import { api } from '@/api/tauri';

/** snake_case → camelCase normalize. Rust serde'i AiModel'i snake_case basar. */
function normalizeModel(m: {
  id: string;
  label: string;
  context_window?: number;
  supports_streaming: boolean;
}): AIModel {
  return {
    id: m.id,
    label: m.label,
    contextWindow: m.context_window,
    supportsStreaming: m.supports_streaming,
  };
}

export async function fetchModels(provider: ProviderId): Promise<AIModel[]> {
  try {
    const list = await api.aiModels(provider);
    return list.map(normalizeModel);
  } catch {
    return [];
  }
}

/** Stream id üretici — Date.now() + counter ile çakışma riski sıfır.
 *  Rust tarafında ai_aborts HashMap key'i olarak kullanılır. */
let _streamCounter = 0;
function nextStreamId(): number {
  _streamCounter = (_streamCounter + 1) % 1_000_000;
  // Date.now()*1000 + counter — saniye altı çakışma için yeterli benzersizlik.
  return Date.now() * 1000 + _streamCounter;
}

/** Provider tarafından raporlanan kesin token kullanımı.
 *  Yoksa frontend `estimateTokens` (4 char/token) tahmine düşer. */
export interface ExactUsage {
  input: number;
  output: number;
}

/** Caller streamChat'e geçerse provider exact usage raporu yapınca çağrılır.
 *  Çoğu provider stream sonunda tek kez bilgi gönderir. */
export type UsageCallback = (usage: ExactUsage) => void;

/**
 * Rust ai_chat_stream'i çağır, gelen chunk'ları AsyncIterable<string> olarak
 * yield et. AbortSignal ile gerçek iptal — frontend abort olunca Rust tarafında
 * `ai_abort_stream(streamId)` invoke edilir, oneshot kanalı `tokio::select!`
 * ile chat future'ını drop eder, reqwest HTTP bağlantısı kapatılır → daha
 * fazla token harcanmaz (önceden frontend cancel "yanılsama"ydı, Rust task
 * tam yanıtı üretmeye devam ederdi).
 *
 * `onUsage` opsiyonel: provider Anthropic message_delta / OpenAI
 * stream_options.include_usage / Ollama done frame ile kesin token sayısı
 * raporlarsa çağrılır. Yoksa caller estimate'a düşer.
 */
export async function* streamChat(
  provider: ProviderId,
  messages: ChatMessage[],
  options: ChatOptions,
  onUsage?: UsageCallback,
): AsyncIterable<string> {
  const streamId = nextStreamId();
  const channel = new Channel<string>();
  const usageChannel = new Channel<ExactUsage>();
  const queue: string[] = [];
  let done = false;
  let error: Error | null = null as Error | null;
  let resolveNext: (() => void) | null = null;

  channel.onmessage = (chunk) => {
    queue.push(chunk);
    resolveNext?.();
  };
  usageChannel.onmessage = (info) => {
    onUsage?.(info);
  };

  const callPromise = invoke<void>('ai_chat_stream', {
    provider,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    options: {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      endpoint: options.endpoint,
    },
    streamId,
    onChunk: channel,
    onUsage: usageChannel,
  })
    .then(() => {
      done = true;
      resolveNext?.();
    })
    .catch((e) => {
      done = true;
      error = e instanceof Error ? e : new Error(String(e));
      resolveNext?.();
    });

  // AbortSignal — Rust tarafında stream'i iptal et + frontend kanalını kes.
  const onAbort = () => {
    // Rust task'ını gerçekten iptal — token harcaması durur. invoke fail
    // olursa stream zaten bitmiş demektir, sessiz geç.
    invoke('ai_abort_stream', { streamId }).catch(() => { /* ignore */ });
    done = true;
    error = new Error('AbortError');
    resolveNext?.();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((resolve) => { resolveNext = resolve; });
      resolveNext = null;
    }
    if (error) {
      // AbortError special — caller upstream'de tanır
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        const e = new Error('AbortError');
        e.name = 'AbortError';
        throw e;
      }
      throw error;
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    // callPromise'ı bekle — settled olsun (error catch zaten yapıldı)
    await callPromise.catch(() => { /* yutuldu */ });
  }
}
