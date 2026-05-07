// Toast notification store — basit, anti-spam, otomatik kapanır.

import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  /** Tıklamada toast otomatik kapanır; false dönerse kapanmaz. */
  handler: () => void | Promise<void> | boolean | Promise<boolean>;
  primary?: boolean;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Otomatik kapanma süresi (ms). 0 = manuel kapatma. */
  duration: number;
  actions?: ToastAction[];
}

export interface ToastOptions {
  duration?: number;
  actions?: ToastAction[];
}

let nextId = 1;

export const useToastsStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);

  function push(kind: ToastKind, message: string, opts: ToastOptions = {}): number {
    const id = nextId++;
    const duration = opts.duration ?? 3500;
    items.value.push({ id, kind, message, duration, actions: opts.actions });
    if (duration > 0) {
      window.setTimeout(() => dismiss(id), duration);
    }
    return id;
  }

  function info(msg: string, opts?: ToastOptions | number) {
    return push('info', msg, typeof opts === 'number' ? { duration: opts } : opts);
  }
  function success(msg: string, opts?: ToastOptions | number) {
    return push('success', msg, typeof opts === 'number' ? { duration: opts } : opts);
  }
  function warning(msg: string, opts?: ToastOptions | number) {
    return push('warning', msg, typeof opts === 'number' ? { duration: opts } : opts);
  }
  function error(msg: string, opts: ToastOptions | number = 6000) {
    return push('error', msg, typeof opts === 'number' ? { duration: opts } : opts);
  }

  function dismiss(id: number) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, push, info, success, warning, error, dismiss };
});
