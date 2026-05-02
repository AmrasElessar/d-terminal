// Pre-send secret redaction (architecture-v1.1.md §5.4).
//
// Terminal çıktısı AI'a gönderilmeden önce buradan geçer. Eşleşen değerler
// `[REDACTED]` ile değiştirilir; redacte edilen satır sayısı kullanıcıya
// preview modal'ında bildirilir.

const PATTERNS: RegExp[] = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,                                  // OpenAI/Anthropic
  /\b(ghp_[a-zA-Z0-9]{36})\b/g,                                  // GitHub PAT
  /(?:password|passwd|token|api[_-]?key|secret)\s*[:=]\s*["']?([^\s"']+)/gi,
  /\bAKIA[0-9A-Z]{16}\b/g,                                       // AWS access key
  /\bxox[baprs]-[a-zA-Z0-9-]+\b/g,                                // Slack tokens
  /\b[A-Za-z0-9+/=]{40,}\b/g,                                    // long base64-ish blobs (best-effort)
];

export interface RedactionResult {
  text: string;
  redactedLines: number;
}

export function redact(input: string, customPatterns: RegExp[] = []): RedactionResult {
  const all = [...PATTERNS, ...customPatterns];
  let redactedLines = 0;
  const lines = input.split('\n').map((line) => {
    let modified = line;
    let touched = false;
    for (const re of all) {
      const before = modified;
      modified = modified.replace(re, '[REDACTED]');
      if (modified !== before) touched = true;
    }
    if (touched) redactedLines += 1;
    return modified;
  });
  return { text: lines.join('\n'), redactedLines };
}
