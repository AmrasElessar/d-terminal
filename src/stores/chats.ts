// Per-pane AI chat geçmişi store'u.
//
// Daha önce AIChatPane.vue mesajları kendi component-local `ref<ChatMessage[]>`
// içinde tutuyordu — pane unmount'unda (split kapatma, tab değişimi, layout
// restructure) konuşma TAMAMEN kayboluyordu. Brainstorm modunda 5 dakikalık
// 50K+ token tartışmasından sonra kullanıcı yanlışlıkla pane'i kapattığında
// her şey sıfırlanırdı (Frontend bugs audit · K-5).
//
// Bu store messages'ı pane id ile indeksler ve component lifecycle'ından
// bağımsız tutar. cleanupPaneState (panes.ts) pane gerçekten kalıcı silinince
// state'i siler — gerçek leak vektörünü kapatır.

import { defineStore } from 'pinia';
import { ref, type Ref } from 'vue';
import type { ChatMessage } from '@/types/ai';

export const useChatsStore = defineStore('chats', () => {
  /** Pane id → kendi reactive ref'i. Component remount'tan etkilenmez;
   *  store yaşam süresi pane'in mantıksal varlığına bağlı. */
  const refsByPane = new Map<string, Ref<ChatMessage[]>>();

  /** Pane için mevcut ref'i döndür ya da boş bir ref yaratıp kaydet. */
  function ensure(paneId: string): Ref<ChatMessage[]> {
    let r = refsByPane.get(paneId);
    if (!r) {
      r = ref<ChatMessage[]>([]);
      refsByPane.set(paneId, r);
    }
    return r;
  }

  /** Pane kalıcı silinince — closeTab/closePane/loadWorkspace'ten çağrılır. */
  function clearPane(paneId: string) {
    refsByPane.delete(paneId);
  }

  return { ensure, clearPane };
});
