<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useToastsStore } from '@/stores/toasts';

const toasts = useToastsStore();
const { t } = useI18n();
</script>

<template>
  <Teleport to="body">
    <div class="toasts" aria-live="polite">
      <div
        v-for="toast in toasts.items"
        :key="toast.id"
        class="toast"
        :class="`toast--${toast.kind}`"
        role="status"
      >
        <span class="toast__msg">{{ toast.message }}</span>
        <button
          type="button"
          class="toast__dismiss"
          :title="t('toast.dismiss')"
          :aria-label="t('toast.dismiss')"
          @click="toasts.dismiss(toast.id)"
        >
×
</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  bottom: 32px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 200;
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-left-width: 3px;
  padding: 10px 12px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 240px;
  max-width: 420px;
  font-size: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  animation: slide-in 0.18s ease-out;
}
@keyframes slide-in {
  from { transform: translateX(20px); opacity: 0; }
  to   { transform: translateX(0); opacity: 1; }
}
.toast--info     { border-left-color: var(--color-accent); }
.toast--success  { border-left-color: var(--color-green); }
.toast--warning  { border-left-color: var(--color-yellow); }
.toast--error    { border-left-color: var(--color-red); }
.toast__msg { flex: 1; }
.toast__dismiss {
  background: transparent;
  border: none;
  color: var(--color-fg);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  opacity: 0.5;
}
.toast__dismiss:hover { opacity: 1; }
</style>
