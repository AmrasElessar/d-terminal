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
  | 'capture';     // sadece logla (devTools/log file)

export const TRIGGER_ACTION_KINDS: readonly TriggerActionKind[] = ['toast', 'sendToAi', 'runSnippet', 'capture'];
export const TRIGGER_SCOPES: readonly TriggerScope[] = ['all', 'powershell', 'cmd', 'wsl'];

/** `runSnippet` için minimum cooldown — çıktıyı tetikleyen snippet'in kendi
 *  çıktısıyla kendini sonsuz döngüye sokmasını engeller. */
export const RUN_SNIPPET_MIN_COOLDOWN_MS = 5_000;
/** `runSnippet` dakika başına en fazla bu kadar çalışır; aşılırsa trigger
 *  otomatik devre dışı kalır. */
export const RUN_SNIPPET_MAX_PER_MINUTE = 6;

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
  /** `runSnippet` aksiyonunun terminal çıktısıyla OTOMATİK komut çalıştırmasına
   *  açık izin. Terminal çıktısı güvenilmez (cat edilen dosya, uzak log) —
   *  varsayılan kapalı; kapalıyken eşleşme yalnızca bildirim gösterir. */
  allowAutoRun?: boolean;
  createdAt: string;
}

/** Persist edilmiş (güvenilmez) veriden Trigger doğrula; geçersizse null. */
export function sanitizeTrigger(raw: unknown): Trigger | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const action = o.action as Record<string, unknown> | undefined;
  if (
    typeof o.id !== 'string' ||
    typeof o.name !== 'string' ||
    typeof o.pattern !== 'string' ||
    o.pattern.length > 1000 ||
    !action ||
    typeof action.kind !== 'string' ||
    !(TRIGGER_ACTION_KINDS as readonly string[]).includes(action.kind)
  ) {
    return null;
  }
  const flags = typeof o.flags === 'string' ? o.flags.replace(/[^imsu]/g, '') : '';
  const scope = (TRIGGER_SCOPES as readonly string[]).includes(o.scope as string)
    ? (o.scope as TriggerScope)
    : 'all';
  const cooldown = typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs)
    ? Math.min(Math.max(0, o.cooldownMs), 3_600_000)
    : 1000;
  return {
    id: o.id,
    name: o.name.slice(0, 200),
    pattern: o.pattern,
    flags,
    scope,
    action: {
      kind: action.kind as TriggerActionKind,
      payload: typeof action.payload === 'string' ? action.payload.slice(0, 4000) : undefined,
    },
    enabled: o.enabled === true,
    cooldownMs: cooldown,
    allowAutoRun: o.allowAutoRun === true,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
  };
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
    allowAutoRun: false,
  };
}
