// Doğal dil → komut çevirici (Warp Agent Mode paritesi).
//
// Aktif AI provider'ı kullanır, kısa system prompt ile shell-spesifik komut üretir.
// Tek atımlık çağrı — streaming chunks toplanır, plain text döner.

import { useAIStore } from '@/stores/ai';
import type { ChatMessage, ChatOptions } from '@/types/ai';
import type { PaneType } from '@/types/pane';

export interface SuggestRequest {
  prompt: string;
  paneType: PaneType;
  /** Aktif terminal pane'inin son N satır context'i (opsiyonel). */
  context?: string;
  signal?: AbortSignal;
}

const SHELL_OF: Record<PaneType, string> = {
  powershell: 'PowerShell (pwsh / Windows PowerShell)',
  cmd: 'Windows Command Prompt (cmd.exe)',
  wsl: 'Linux bash (WSL)',
  aiChat: 'PowerShell',
  logStream: 'PowerShell',
  welcome: 'PowerShell',
};

function systemPrompt(paneType: PaneType): string {
  const shell = SHELL_OF[paneType];
  return [
    `You are a shell command generator for ${shell}.`,
    `The user describes what they want in natural language.`,
    `You respond with ONLY the command — no explanation, no markdown fences, no leading/trailing prose.`,
    `If the request is ambiguous, pick the most common interpretation.`,
    `Prefer one-liner commands. Use newlines only when truly necessary.`,
    `Never produce destructive commands (rm -rf, Format-Volume, del /S) unless the user explicitly says "force" or "no confirmation".`,
  ].join(' ');
}

export async function suggestCommand(req: SuggestRequest): Promise<string> {
  const ai = useAIStore();
  const provider = await ai.resolveProvider();
  if (!provider) throw new Error('no-provider');
  const model = ai.activeModel ?? (await provider.models())[0]?.id;
  if (!model) throw new Error('no-model');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(req.paneType) },
  ];
  if (req.context) {
    messages.push({
      role: 'system',
      content: `Recent terminal output (last lines, may help disambiguate):\n${req.context}`,
    });
  }
  messages.push({ role: 'user', content: req.prompt });

  const opts: ChatOptions = {
    model,
    temperature: 0.2,
    maxTokens: 256,
    signal: req.signal,
  };

  let out = '';
  for await (const chunk of provider.chat(messages, opts)) {
    out += chunk;
  }
  // Markdown fence'leri zarif strip et — bazı modeller "```pwsh\n...\n```" döner
  out = out.trim();
  out = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '');
  // Tek satır comment kaldır (# foo başlangıçta)
  out = out.replace(/^#[^\n]*\n/, '');
  return out.trim();
}
