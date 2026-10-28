// useDialogA11y — modal unmount olduğunda (isOpen false'a dönmeden) global
// Escape listener'ı kaldırılmalı; aksi halde terminaldeki her Esc yutulur.

import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useDialogA11y } from './useDialogA11y';

const Dialog = defineComponent({
  setup() {
    const el = ref<HTMLElement | null>(null);
    useDialogA11y(el, () => true, { onEscape: () => {} });
    return () => h('div', { ref: el }, [h('button', 'ok')]);
  },
});

afterEach(() => {
  document.body.innerHTML = '';
});

function escapeReachesWindow(): boolean {
  let reached = false;
  const onWin = () => {
    reached = true;
  };
  window.addEventListener('keydown', onWin);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.removeEventListener('keydown', onWin);
  return reached;
}

describe('useDialogA11y', () => {
  it('açıkken Escape yakalanır, unmount sonrası serbest kalır', async () => {
    const w = mount(Dialog, { attachTo: document.body });
    await new Promise((r) => setTimeout(r, 0));
    expect(escapeReachesWindow()).toBe(false);
    w.unmount();
    expect(escapeReachesWindow()).toBe(true);
  });

  it('defalarca aç/kapa listener biriktirmez', async () => {
    for (let i = 0; i < 3; i++) {
      const w = mount(Dialog, { attachTo: document.body });
      await new Promise((r) => setTimeout(r, 0));
      w.unmount();
    }
    expect(escapeReachesWindow()).toBe(true);
  });
});
