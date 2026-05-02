<script setup lang="ts">
import AppShell from '@/components/AppShell.vue';
</script>

<template>
  <AppShell />
</template>

<style>
:root {
  --color-bg: #0a0e1a;
  --color-fg: #e2e8f0;
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
  --font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace;
  --font-size: 14px;
  --ui-opacity: 1;
  --ui-blur: 0px;
  --ui-radius: 8px;
  --pane-title-gradient: linear-gradient(90deg, var(--color-accent), var(--color-accent2));
}

* { box-sizing: border-box; }

html, body, #app {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-family);
  font-size: 13px;
  overflow: hidden;
}

button { font-family: inherit; }
</style>
