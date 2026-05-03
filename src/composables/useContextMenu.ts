// Sağ tık menüsü için global state — bir anda yalnız bir menü açık.
//
// Kullanım:
//   const { show } = useContextMenu();
//   <div @contextmenu.prevent="show($event, items)" />
//
// items: { id, label, icon?, shortcut?, danger?, disabled?, onClick }
// İsterseniz ayraç için { kind: 'separator' } verin.

import { reactive } from 'vue';

export interface MenuAction {
  kind?: 'item';
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}

export interface MenuSeparator {
  kind: 'separator';
}

export type MenuEntry = MenuAction | MenuSeparator;

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: MenuEntry[];
}

const state = reactive<MenuState>({
  open: false,
  x: 0,
  y: 0,
  items: [],
});

export function useContextMenu() {
  function show(event: MouseEvent, items: MenuEntry[]) {
    state.x = event.clientX;
    state.y = event.clientY;
    state.items = items;
    state.open = true;
  }
  function hide() {
    state.open = false;
  }
  return { state, show, hide };
}
