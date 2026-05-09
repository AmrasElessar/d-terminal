<script setup lang="ts">
import { ref } from 'vue';
import AppShell from '@/components/AppShell.vue';
import Splash from '@/components/Splash.vue';

const booted = ref(false);
</script>

<template>
  <Splash v-if="!booted" @done="booted = true" />
  <AppShell v-else />
</template>

<style>
:root {
  --color-bg: #0a0e1a;
  --color-fg: #c8d3e7;
  --color-accent: #00b4d8;
  --color-accent2: #7c3aed;
  --color-cursor: #00b4d8;
  --color-selection: #1e3a5f;
  --color-black: #1a1f2e;
  --color-red: #ff5f57;
  --color-green: #28c840;
  --color-yellow: #ffbd2e;
  --color-blue: #1e90ff;
  --color-magenta: #b47aea;
  --color-cyan: #00b4d8;
  --color-white: #e2e8f0;
  /* WCAG AA: --color-bg(#0a0e1a, L=0.0058) zemininde 4.5:1 ratio için
     dim açık tonu #7a8290 (L=0.213) → 5.0:1. Önceki #5a6478 → 3.97:1 fail. */
  --color-dim: #7a8290;
  --color-line: color-mix(in srgb, var(--color-fg) 5%, transparent);
  /* Semantik renk overlay'leri — child component'lerde rgba(...) tekrar
     etmesin diye merkezi tanım. Tema değişince otomatik adapte olur
     (color-mix accent/red/black üzerinden çalışır). */
  --color-accent-soft:    color-mix(in srgb, var(--color-accent) 8%,  transparent);
  --color-accent-soft-12: color-mix(in srgb, var(--color-accent) 12%, transparent);
  --color-accent-soft-15: color-mix(in srgb, var(--color-accent) 15%, transparent);
  --color-accent-soft-22: color-mix(in srgb, var(--color-accent) 22%, transparent);
  --color-accent-glow:    color-mix(in srgb, var(--color-accent) 30%, transparent);
  --color-accent-glow-strong: color-mix(in srgb, var(--color-accent) 50%, transparent);
  --color-red-soft-08:    color-mix(in srgb, var(--color-red)    8%,  transparent);
  --color-red-soft-15:    color-mix(in srgb, var(--color-red)    15%, transparent);
  --color-red-soft-30:    color-mix(in srgb, var(--color-red)    30%, transparent);
  --color-overlay-faint:  rgba(0, 0, 0, 0.3);
  --color-overlay-light:  rgba(0, 0, 0, 0.4);
  --color-overlay-medium: rgba(0, 0, 0, 0.5);
  --color-overlay-dark:   rgba(0, 0, 0, 0.6);
  --font-family: 'JetBrains Mono', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', monospace;
  --font-size: 11px;
  --line-height: 1.35;
  --bg-alpha: 1;
  --ui-blur: 0px;
  --ui-radius: 2px;
  --pane-title-gradient: linear-gradient(90deg, var(--color-accent), var(--color-accent2));
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  /* Tauri window transparent: true; bu bg color-mix ile alpha alır,
     kullanıcı opacity slider'ı ile ayarlar. alpha=0 = pencere arkası tamamen şeffaf. */
  background: color-mix(in srgb, var(--color-bg) calc(var(--bg-alpha) * 100%), transparent);
  color: var(--color-fg);
  font-family: var(--font-family);
  font-size: var(--font-size);
  line-height: var(--line-height);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
#app {
  margin: 0;
  padding: 0;
  height: 100%;
  background: transparent;
  backdrop-filter: blur(var(--ui-blur, 0));
}

button {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

/* WCAG 2.4.7 (Focus Visible): klavye-only kullanıcı (Tab navigation) için
   açık fokus iz. Mouse tıklamasında görünmez (`:focus-visible` semantiği).
   Tüm interaktif elementler bu kuralı miras alır; component'ler kendi
   focus stilini override edebilir. */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: 2px;
}
button:focus-visible,
[role='button']:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -1px;
}

/* WCAG 2.3.3 (Animation from Interactions) — kullanıcı OS-seviyesinde
   "reduce motion" tercih ediyorsa tüm animasyon/transition'ı sıfıra yakın
   indir. Epileptik tetikleyici riski + cihaz pil/perf hassasiyeti.
   Splash typewriter, toast slide-in, AI streaming spinner, kamera flash,
   statusBarPulse vs. tek satırda uyumlu hale gelir. */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

::selection { background: var(--color-selection); }

/* Custom scrollbar — thin, mono */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: 0;
}
::-webkit-scrollbar-thumb:hover { background: var(--color-accent); }
</style>
