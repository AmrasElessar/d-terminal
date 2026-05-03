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

/**
 * Rust ai_chat_stream'i çağır, gelen chunk'ları AsyncIterable<string> olarak
 * yield et. AbortSignal ile iptal — frontend'de promise reject olur, Rust
 * tarafında stream consumer drop edildiğinde provider kendi error path'ine
 * düşer.
 */
export async function* streamChat(
  provider: ProviderId,
  messages: ChatMessage[],
  options: ChatOptions,
): AsyncIterable<string> {
  const channel = new Channel<string>();
  const queue: string[] = [];
  let done = false;
  // TS narrows `error` to never inside the loop because we only assign
  // null at init; explicit annotation prevents that.
  let error: Error | null = null as Error | null;
  let resolveNext: (() => void) | null = null;

  channel.onmessage = (chunk) => {
    queue.push(chunk);
    resolveNext?.();
  };

  const callPromise = invoke<void>('ai_chat_stream', {
    provider,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    options: {
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    },
    onChunk: channel,
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

  // AbortSignal — channel'ı kes (callPromise hata dönecektir)
  const onAbort = () => {
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
      if (error.message === 'AbortError') {
        const e = new Error('AbortError');
        e.name = 'AbortError';
        throw e;
      }
      // Rust hata mesajını AnthropicProvider'ın eski 'apiFailed:...' formatına
      // benzer bırak — UI tarafı zaten parse ediyor.
      throw error;
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
    // callPromise'ı bekle — settled olsun (error catch zaten yapıldı)
    await callPromise.catch(() => { /* yutuldu */ });
  }
}
