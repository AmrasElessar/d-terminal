// Output trigger sistemi (iTerm2 paritesi).
//
// Terminal output'unda regex pattern eşleşince action tetikle.
// Pattern eşleşmesi line-based — her tam satırda test edilir (PTY kısmi
// geldiğinde buffer'a eklenir, '\n' geldiğinde satır flush + match).

export type TriggerScope = 'all' | 'powershell' | 'cmd' | 'wsl';

export type TriggerActionKind =
  | 'toast'        // toast notification göster ({{0}}=full match, {{1}}=group 1)
  | 'sendToAi'     // AI Chat pane'e ilet (pattern + context satırları)
  | 'runSnippet'   // snippet id ile çalıştır (snippet store'dan)
  | 'highlight'    // satırı renkle (basit overlay; v2 için)
  | 'capture';     // sadece logla (devTools/log file)

export interface TriggerAction {
  kind: TriggerActionKind;
  /** Action-specific payload — toast.message, sendToAi.template, runSnippet.snippetId, highlight.color */
  payload?: string;
}

export interface Trigger {
  id: string;
  name: string;
  /** Regex source (flags ayrı tutulur — `g` her zaman eklenir). */
  pattern: string;
  /** `i` (case-insensitive) destekleniyor. `m` zaten line-based test edildiği için gereksiz. */
  flags: string;
  scope: TriggerScope;
  action: TriggerAction;
  enabled: boolean;
  /** Birim zamanda kaç kez ateşlenebilir (rate limit). 0 = sınırsız. */
  cooldownMs: number;
  createdAt: string;
}

export interface TriggerMatch {
  trigger: Trigger;
  text: string;
  groups: string[];
  paneId: string;
}

/** {{0}}, {{1}} gibi placeholder'ları match group'larıyla değiştir. */
export function expandTemplate(template: string, match: RegExpExecArray): string {
  return template.replace(/\{\{(\d+)\}\}/g, (_, idx) => match[Number(idx)] ?? '');
}

export function defaultTrigger(): Omit<Trigger, 'id' | 'createdAt'> {
  return {
    name: '',
    pattern: '',
    flags: '',
    scope: 'all',
    action: { kind: 'toast', payload: '{{0}}' },
    enabled: true,
    cooldownMs: 1000,
  };
}
