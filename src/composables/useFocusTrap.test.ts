// useFocusTrap — modal focus trap + restoration composable testi.
//
// Test stratejisi: gerçek DOM + JSDOM. Mount sırasında bir panel + 3 buton
// kurulur, composable bağlanır, Tab/Shift+Tab synthetic event'leri ile
// focus döngüsünü doğrularız. Restoration için open=false toggle'ı ile
// önceki active element'in geri focus edildiği test edilir.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { useFocusTrap } from './useFocusTrap';

// Composable global window listener bağladığı için test izolasyonu kritik:
// her test mount eder, afterEach unmount eder → onBeforeUnmount cleanup
// listener'ı kaldırır.
const wrappers: VueWrapper[] = [];

function makeHarness(initialOpen: boolean) {
  const open = ref(initialOpen);
  const panel = ref<HTMLElement | null>(null);
  const initialFocus = ref<HTMLElement | null>(null);

  const Harness = defineComponent({
    setup() {
      useFocusTrap({ panel, open, initialFocus });
      return () =>
        open.value
          ? h(
              'article',
              { ref: (el) => (panel.value = el as HTMLElement) },
              [
                h(
                  'button',
                  { ref: (el) => (initialFocus.value = el as HTMLElement), id: 'b1' },
                  'First',
                ),
                h('button', { id: 'b2' }, 'Middle'),
                h('button', { id: 'b3' }, 'Last'),
              ],
            )
          : h('div', { id: 'closed' }, 'closed');
    },
  });

  const wrapper = mount(Harness, { attachTo: document.body });
  wrappers.push(wrapper);
  return { wrapper, open, panel, initialFocus };
}

function fireTab(shift = false) {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

/** Microtask kuyruğunu boşalt — composable initialFocus'u queueMicrotask
 *  ile veriyor, iki tick yeterli (mount tick + microtask tick). */
async function flushFocusTick() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useFocusTrap', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    while (wrappers.length > 0) {
      const w = wrappers.pop();
      try {
        w?.unmount();
      } catch {
        /* swallow */
      }
    }
    document.body.innerHTML = '';
  });

  it('open false ile mount edilince Tab event default davranışı yutulmaz', () => {
    makeHarness(false);
    const event = fireTab();
    expect(event.defaultPrevented).toBe(false);
  });

  it('open true → açılışta initialFocus elementine focus verilir', async () => {
    makeHarness(true);
    await flushFocusTick();
    expect(document.activeElement?.id).toBe('b1');
  });

  it('Tab last → first döner (forward wrap)', async () => {
    makeHarness(true);
    await flushFocusTick();
    const last = document.getElementById('b3') as HTMLButtonElement;
    last.focus();
    expect(document.activeElement?.id).toBe('b3');
    fireTab();
    expect(document.activeElement?.id).toBe('b1');
  });

  it('Shift+Tab first → last döner (backward wrap)', async () => {
    makeHarness(true);
    await flushFocusTick();
    const first = document.getElementById('b1') as HTMLButtonElement;
    first.focus();
    expect(document.activeElement?.id).toBe('b1');
    fireTab(true);
    expect(document.activeElement?.id).toBe('b3');
  });

  it('Tab wrap durumunda event preventDefault olur', async () => {
    makeHarness(true);
    await flushFocusTick();
    const last = document.getElementById('b3') as HTMLButtonElement;
    last.focus();
    const event = fireTab();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Focus restoration: open false olunca önceki active element geri focus alır', async () => {
    const outer = document.createElement('button');
    outer.id = 'outer';
    outer.textContent = 'Outer';
    document.body.appendChild(outer);
    outer.focus();
    expect(document.activeElement?.id).toBe('outer');

    const { open } = makeHarness(false);
    open.value = true;
    await flushFocusTick();
    expect(document.activeElement?.id).toBe('b1');

    open.value = false;
    await flushFocusTick();
    expect(document.activeElement?.id).toBe('outer');
  });

  it('Panel içi orta elementte Tab → standart davranış (wrap tetiklenmez)', async () => {
    makeHarness(true);
    await flushFocusTick();
    const middle = document.getElementById('b2') as HTMLButtonElement;
    middle.focus();
    const event = fireTab();
    // Composable yalnız first/last sınırlarında preventDefault yapar; aradaki
    // butonlar arası geçiş browser native davranışına bırakılır.
    expect(event.defaultPrevented).toBe(false);
  });
});
