export interface ThemeColors {
  background: string;
  foreground: string;
  accent: string;
  accent2: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface ThemeFont {
  family: string;
  size: number;
  ligatures: boolean;
}

export interface ThemeUi {
  blur: number;
  opacity: number;
  borderRadius: number;
  glowEffect: boolean;
}

export interface Theme {
  name: string;
  author: string;
  version: string;
  description?: string;
  colors: ThemeColors;
  font: ThemeFont;
  ui: ThemeUi;
  paneTitle?: { gradient: string[] };
}
