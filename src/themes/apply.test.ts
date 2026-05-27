// themes/apply — CSS variable mutation testi.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Theme } from '@/types/theme';
import { applyTheme, xtermThemeOf } from './apply';

const FULL_THEME: Theme = {
  name: 'D-Test',
  description: 'unit test fixture',
  background: 'dark',
  colors: {
    background: '#0a0e1a',
    foreground: '#c8d3e7',
    accent: '#00b4d8',
    accent2: '#7c3aed',
    cursor: '#00b4d8',
    selection: '#1e3a5f',
    black: '#1a1f2e',
    red: '#ff5f57',
    green: '#28c840',
    yellow: '#ffbd2e',
    blue: '#1e90ff',
    magenta: '#b47aea',
    cyan: '#00b4d8',
    white: '#e2e8f0',
    brightBlack: '#5a6478',
    brightRed: '#ff7a72',
    brightGreen: '#5be077',
    brightYellow: '#ffd76a',
    brightBlue: '#5ba3ff',
    brightMagenta: '#cca0ff',
    brightCyan: '#5be0e0',
    brightWhite: '#ffffff',
  },
  ui: { borderRadius: 4, blur: 0, opacity: 1, glowEffect: false },
  paneTitle: { gradient: ['#00b4d8', '#7c3aed'] },
} as unknown as Theme;

describe('applyTheme', () => {
  beforeEach(() => {
    // Tüm CSS değişkenlerini sıfırla
    const root = document.documentElement;
    root.removeAttribute('style');
  });

  it('Temel renkler --color-* olarak set edilir', () => {
    applyTheme(FULL_THEME);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--color-bg').trim()).toBe('#0a0e1a');
    expect(root.style.getPropertyValue('--color-fg').trim()).toBe('#c8d3e7');
    expect(root.style.getPropertyValue('--color-accent').trim()).toBe('#00b4d8');
  });

  it('16 ANSI rengi --ansi-* + --ansi-br* olarak set edilir', () => {
    applyTheme(FULL_THEME);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ansi-red').trim()).toBe('#ff5f57');
    expect(root.style.getPropertyValue('--ansi-brRed').trim()).toBe('#ff7a72');
    expect(root.style.getPropertyValue('--ansi-cyan').trim()).toBe('#00b4d8');
    expect(root.style.getPropertyValue('--ansi-brWhite').trim()).toBe('#ffffff');
  });

  it('UI borderRadius px formatında --ui-radius', () => {
    applyTheme(FULL_THEME);
    expect(document.documentElement.style.getPropertyValue('--ui-radius').trim()).toBe('4px');
  });

  it('paneTitle.gradient varsa --pane-title-gradient linear-gradient ile', () => {
    applyTheme(FULL_THEME);
    const grad = document.documentElement.style.getPropertyValue('--pane-title-gradient').trim();
    expect(grad).toContain('linear-gradient');
    expect(grad).toContain('#00b4d8');
    expect(grad).toContain('#7c3aed');
  });

  it('paneTitle.gradient eksikse --pane-title-gradient set edilmez', () => {
    const noGrad = { ...FULL_THEME, paneTitle: undefined } as unknown as Theme;
    applyTheme(noGrad);
    expect(document.documentElement.style.getPropertyValue('--pane-title-gradient')).toBe('');
  });

  it('brightRed undefined ise red fallback olarak kullanılır', () => {
    const partial = { ...FULL_THEME, colors: { ...FULL_THEME.colors, brightRed: undefined } } as unknown as Theme;
    applyTheme(partial);
    expect(document.documentElement.style.getPropertyValue('--ansi-brRed').trim()).toBe('#ff5f57');
  });
});

describe('xtermThemeOf', () => {
  it('xterm-uyumlu obje üretir: background/foreground/cursor + 16 ANSI', () => {
    const xt = xtermThemeOf(FULL_THEME);
    expect(xt.background).toBe('#0a0e1a');
    expect(xt.foreground).toBe('#c8d3e7');
    expect(xt.cursor).toBe('#00b4d8');
    expect(xt.selectionBackground).toBe('#1e3a5f');
    expect(xt.brightBlack).toBe('#5a6478');
  });

  it('Eksik brightX colors red/blue/... fallback olur', () => {
    const partial = { ...FULL_THEME, colors: { ...FULL_THEME.colors, brightGreen: undefined } } as unknown as Theme;
    const xt = xtermThemeOf(partial);
    expect(xt.brightGreen).toBe(FULL_THEME.colors.green);
  });
});
