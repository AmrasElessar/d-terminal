// Komponent içinden kısayol bağlama composable'ı.

import { onBeforeUnmount, onMounted } from 'vue';
import { keybindings } from '@/keybindings/registry';

export function useShortcut(id: string, handler: (e: KeyboardEvent) => void) {
  onMounted(() => keybindings.register(id, handler));
  onBeforeUnmount(() => keybindings.unregister(id));
}
