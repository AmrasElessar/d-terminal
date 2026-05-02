// Toast notification store — basit, anti-spam, otomatik kapanır.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Otomatik kapanma süresi (ms). 0 = manuel kapatma. */
  duration: number;
}

let nextId = 1;

export const useToastsStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);

  function push(kind: ToastKind, message: string, duration = 3500): number {
    const id = nextId++;
    items.value.push({ id, kind, message, duration });
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration);
    }
    return id;
  }

  function info(msg: string, duration?: number) { return push('info', msg, duration); }
  function success(msg: string, duration?: number) { return push('success', msg, duration); }
  function warning(msg: string, duration?: number) { return push('warning', msg, duration); }
  function error(msg: string, duration = 6000) { return push('error', msg, duration); }

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, push, info, success, warning, error, dismiss };
});
