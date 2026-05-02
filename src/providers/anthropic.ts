// Anthropic Claude provider — Messages API, SSE streaming.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';

const DEFAULT_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

const MODELS: AIModel[] = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', contextWindow: 1_000_000, supportsStreaming: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextWindow: 200_000, supportsStreaming: true },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', contextWindow: 200_000, supportsStreaming: true },
];

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic Claude';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'anthropic');
  }

  async models(): Promise<AIModel[]> {
    return MODELS;
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const key = await api.aiKeyReveal('anthropic');
    if (!key) throw new Error('noKey');

    // System mesajını ayır — Anthropic ayrı top-level field bekler
    const system = messages.find((m) => m.role === 'system')?.content;
    const conversational = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const body = {
      model: options.model,
      max_tokens: options.maxTokens ?? 4096,
      temperature: options.temperature,
      stream: true,
      ...(system ? { system } : {}),
      messages: conversational,
    };

    const response = await fetch(DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': VERSION,
        // Browser/WebView2 tarafından çağrı için CORS bypass
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`apiFailed:${response.status}:${text.slice(0, 200)}`);
    }
    if (!response.body) throw new Error('apiFailed:no-body');

    // SSE parse — Anthropic event akışı: `event: content_block_delta\ndata: {...}\n\n`
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const ev of events) {
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const parsed = JSON.parse(data);
            if (
              parsed.type === 'content_block_delta' &&
              parsed.delta?.type === 'text_delta' &&
              typeof parsed.delta.text === 'string'
            ) {
              yield parsed.delta.text as string;
            }
          } catch {
            // bozuk frame — geç
          }
        }
      }
    }
  }
}
