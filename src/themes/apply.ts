// Tema → CSS variable apply. Komponent re-render etmez, sadece :root vars değişir.

import type { Theme } from '@/types/theme';

const PROPS_MAP: Record<string, (t: Theme) => string> = {
  '--color-bg': (t) => t.colors.background,
  '--color-fg': (t) => t.colors.foreground,
  '--color-accent': (t) => t.colors.accent,
  '--color-accent2': (t) => t.colors.accent2,
  '--color-cursor': (t) => t.colors.cursor,
  '--color-selection': (t) => t.colors.selection,
  '--color-black': (t) => t.colors.black,
  '--color-red': (t) => t.colors.red,
  '--color-green': (t) => t.colors.green,
  '--color-yellow': (t) => t.colors.yellow,
  '--color-blue': (t) => t.colors.blue,
  '--color-magenta': (t) => t.colors.magenta,
  '--color-cyan': (t) => t.colors.cyan,
  '--color-white': (t) => t.colors.white,
  '--font-family': (t) => `"${t.font.family}", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace`,
  '--font-size': (t) => `${t.font.size}px`,
  '--ui-opacity': (t) => `${t.ui.opacity}`,
  '--ui-blur': (t) => `${t.ui.blur}px`,
  '--ui-radius': (t) => `${t.ui.borderRadius}px`,
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [cssVar, getter] of Object.entries(PROPS_MAP)) {
    root.style.setProperty(cssVar, getter(theme));
  }
  // Pane title gradient
  const grad = theme.paneTitle?.gradient;
  if (grad && grad.length >= 2) {
    root.style.setProperty(
      '--pane-title-gradient',
      `linear-gradient(90deg, ${grad.join(', ')})`,
    );
  }
}

/** xterm.js için tema mapping. */
export function xtermThemeOf(theme: Theme) {
  return {
    background: theme.colors.background,
    foreground: theme.colors.foreground,
    cursor: theme.colors.cursor,
    selectionBackground: theme.colors.selection,
    black: theme.colors.black,
    red: theme.colors.red,
    green: theme.colors.green,
    yellow: theme.colors.yellow,
    blue: theme.colors.blue,
    magenta: theme.colors.magenta,
    cyan: theme.colors.cyan,
    white: theme.colors.white,
    brightBlack: theme.colors.brightBlack ?? theme.colors.black,
    brightRed: theme.colors.brightRed ?? theme.colors.red,
    brightGreen: theme.colors.brightGreen ?? theme.colors.green,
    brightYellow: theme.colors.brightYellow ?? theme.colors.yellow,
    brightBlue: theme.colors.brightBlue ?? theme.colors.blue,
    brightMagenta: theme.colors.brightMagenta ?? theme.colors.magenta,
    brightCyan: theme.colors.brightCyan ?? theme.colors.cyan,
    brightWhite: theme.colors.brightWhite ?? theme.colors.white,
  };
}
