// PaneLayout / SplitContainer — leaf değişince PaneSlot yeniden mount olmalı.
// :key olmadan Vue aynı TerminalPane örneğini başka bir leaf için yeniden
// kullanıyordu (tab değişiminde Tab 2 görünürken girdi Tab 1'in PTY'sine
// gidiyordu).

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createI18n } from 'vue-i18n';
import { mount } from '@vue/test-utils';
import { usePanesStore } from '@/stores/panes';
import PaneLayout from './PaneLayout.vue';

const { mounted } = vi.hoisted(() => ({ mounted: [] as string[] }));

vi.mock('./PaneSlot.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      name: 'PaneSlot',
      props: { leaf: { type: Object, required: true } },
      setup(props) {
        // setup leaf id'yi sabitler — TerminalPane'in yaptığı gibi
        const id = (props.leaf as { id: string }).id;
        mounted.push(id);
        return () => h('div', { class: 'slot-stub', 'data-id': id });
      },
    }),
  };
});
vi.mock('@/components/panes/WelcomePane.vue', () => ({ default: { render: () => null } }));

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} } });

describe('PaneLayout :key remount', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mounted.length = 0;
  });

  it('tab değişince yeni leaf için yeni PaneSlot örneği mount edilir', async () => {
    const panes = usePanesStore();
    const a = panes.openPane('powershell', 'A');
    panes.newTab();
    const b = panes.openPane('powershell', 'B');
    const w = mount(PaneLayout, { global: { plugins: [i18n] } });
    expect(w.find('.slot-stub').attributes('data-id')).toBe(b.id);
    panes.setActiveTab(panes.tabs[0]!.id);
    await nextTick();
    expect(w.find('.slot-stub').attributes('data-id')).toBe(a.id);
    expect(mounted).toEqual([b.id, a.id]);
  });

  it('split içinden pane kapatılınca kalan pane doğru id ile render edilir', async () => {
    const panes = usePanesStore();
    const a = panes.openPane('powershell', 'A');
    const b = panes.openPane('powershell', 'B');
    const w = mount(PaneLayout, { global: { plugins: [i18n] } });
    expect(w.findAll('.slot-stub').map((x) => x.attributes('data-id'))).toEqual([a.id, b.id]);
    await panes.closePane(a.id);
    await nextTick();
    expect(w.findAll('.slot-stub').map((x) => x.attributes('data-id'))).toEqual([b.id]);
  });
});
