// SettingsModal — sekmelere bölünmüş yapının smoke testi: her sekme hatasız
// render olur ve kendi içeriğini gösterir.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '@/i18n';

vi.mock('@/api/tauri', () => ({
  // Her API çağrısı boş/sahte bir değerle resolve olur
  api: new Proxy(
    {},
    {
      get: (_t, prop: string) => async () => {
        if (prop === 'settingsAll') return {};
        if (prop.startsWith('ai') || prop.startsWith('secrets')) return null;
        if (prop.startsWith('process') || prop.startsWith('admin')) return false;
        return '';
      },
    },
  ),
}));
vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  isEnabled: vi.fn(async () => false),
}));

import SettingsModal from './SettingsModal.vue';

describe('SettingsModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
  });

  it('tüm sekmeler render olur', async () => {
    const w = mount(SettingsModal, {
      props: { open: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    await flushPromises();
    const tabs = w.findAll('nav.tabs button');
    expect(tabs.length).toBe(7);
    for (const tab of tabs) {
      await tab.trigger('click');
      await flushPromises();
      expect(w.find('section.section').exists()).toBe(true);
      expect(tab.attributes('aria-selected')).toBe('true');
    }
    w.unmount();
  });
});
