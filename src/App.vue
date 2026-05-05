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
  --color-dim: #5a6478;
  --color-line: color-mix(in srgb, var(--color-fg) 5%, transparent);
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
