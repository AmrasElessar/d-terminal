// Global modal/dialog state — tek bir modal aynı anda açık.
// PaneSlot context menu, AppShell butonları, command palette aynı state'i kullanır.

import { reactive } from 'vue';

type ModalKind = 'newPane' | 'settings' | 'history' | 'snippets' | 'commandPalette' | 'about' | 'aiSuggest';
type SessionMode = 'save' | 'load';

interface ModalState {
  newPane: boolean;
  settings: boolean;
  history: boolean;
  snippets: boolean;
  commandPalette: boolean;
  about: boolean;
  aiSuggest: boolean;
  session: { open: boolean; mode: SessionMode };
}

const state = reactive<ModalState>({
  newPane: false,
  settings: false,
  history: false,
  snippets: false,
  commandPalette: false,
  about: false,
  aiSuggest: false,
  session: { open: false, mode: 'save' },
});

function closeAll() {
  state.newPane = false;
  state.settings = false;
  state.history = false;
  state.snippets = false;
  state.commandPalette = false;
  state.about = false;
  state.aiSuggest = false;
  state.session.open = false;
}

export function useModals() {
  return {
    state,
    open(kind: ModalKind) {
      closeAll();
      state[kind] = true;
    },
    openSession(mode: SessionMode) {
      closeAll();
      state.session = { open: true, mode };
    },
    close(kind: ModalKind) {
      state[kind] = false;
    },
    closeSession() {
      state.session.open = false;
    },
    closeAll,
  };
}
