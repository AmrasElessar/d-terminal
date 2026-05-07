<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const emit = defineEmits<{ done: [] }>();

interface Line {
  text: string;
  status: 'pending' | 'loading' | 'ok' | 'warn';
  delay: number;
}

const lines = ref<Line[]>([
  { text: 'init core runtime',         status: 'pending', delay: 80 },
  { text: 'load WebView2 bridge',      status: 'pending', delay: 60 },
  { text: 'open SQLite (WAL mode)',    status: 'pending', delay: 90 },
  { text: 'apply schema migrations',   status: 'pending', delay: 70 },
  { text: 'spawn PTY sidecar',         status: 'pending', delay: 110 },
  { text: 'register Tauri commands',   status: 'pending', delay: 60 },
  { text: 'mount Vue + Pinia stores',  status: 'pending', delay: 70 },
  { text: 'load themes (3)',           status: 'pending', delay: 50 },
  { text: 'load locales',              status: 'pending', delay: 50 },
  { text: 'bind keyboard shortcuts',   status: 'pending', delay: 60 },
  { text: 'subscribe sidecar events',  status: 'pending', delay: 80 },
  { text: 'D-Terminal ready',          status: 'pending', delay: 120 },
]);

const visibleCount = ref(0);

async function play() {
  for (let i = 0; i < lines.value.length; i += 1) {
    visibleCount.value = i + 1;
    lines.value[i]!.status = 'loading';
    await new Promise((r) => setTimeout(r, lines.value[i]!.delay));
    lines.value[i]!.status = 'ok';
  }
  await new Promise((r) => setTimeout(r, 250));
  emit('done');
}

onMounted(play);
</script>

<template>
  <div class="splash">
    <pre class="splash__logo">██████╗       ████████╗
██╔══██╗      ╚══██╔══╝
██║  ██║██████╗  ██║      D-TERMINAL
██║  ██║╚═════╝  ██║      agent-aware shell · v0.1.0
██████╔╝         ██║
╚═════╝          ╚═╝</pre>

    <div class="splash__lines">
      <div
        v-for="(line, idx) in lines.slice(0, visibleCount)"
        :key="idx"
        class="splash__line"
        :class="`splash__line--${line.status}`"
      >
        <span class="splash__marker">
          <template v-if="line.status === 'loading'">◌</template>
          <template v-else-if="line.status === 'ok'">✓</template>
          <template v-else-if="line.status === 'warn'">!</template>
          <template v-else>·</template>
        </span>
        <span class="splash__text">{{ line.text }}</span>
        <span v-if="line.status === 'loading'" class="splash__dots">…</span>
        <span v-else-if="line.status === 'ok'" class="splash__elapsed">[ {{ t('splash.ok') }} ]</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.splash {
  position: fixed;
  inset: 0;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-family);
  font-size: 11px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0 60px;
  gap: 14px;
  z-index: 9999;
  overflow: hidden;
}
.splash::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 30% 50%, var(--color-accent-soft) 0%, transparent 50%);
  pointer-events: none;
}
.splash__logo {
  margin: 0;
  color: var(--color-accent);
  font-size: 11px;
  line-height: 1.1;
  text-shadow: 0 0 14px var(--color-accent-glow-strong);
}
.splash__lines {
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 11px;
  min-width: 380px;
}
.splash__line {
  display: grid;
  grid-template-columns: 18px 1fr auto;
  gap: 8px;
  align-items: center;
  animation: slide-in 0.12s ease-out;
}
@keyframes slide-in {
  from { opacity: 0; transform: translateX(-4px); }
  to   { opacity: 1; transform: translateX(0); }
}
.splash__marker {
  text-align: center;
  color: var(--color-dim);
}
.splash__line--loading .splash__marker {
  color: var(--color-accent);
  animation: spin 0.8s linear infinite;
}
.splash__line--loading .splash__text {
  color: var(--color-fg);
}
.splash__line--ok .splash__marker {
  color: var(--color-green);
}
.splash__line--ok .splash__text {
  color: var(--color-dim);
}
.splash__line--warn .splash__marker {
  color: var(--color-yellow);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.splash__dots {
  color: var(--color-accent);
}
.splash__elapsed {
  color: var(--color-green);
  opacity: 0.6;
  font-size: 10px;
}
</style>
