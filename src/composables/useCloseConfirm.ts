// Pane/tab kapatma onayı — Settings.confirmOnClose mode'una göre dispatch.
//
// Tasarım kararı:
// - `Shift` basılıysa bypass (kullanıcı bilinçli skip — keyboard shortcut'larda
//   da geçerli). Mouse close butonları MouseEvent geçer; AppShell keybinding
//   wrapper KeyboardEvent ya da undefined geçer.
// - Async — confirmAsk Tauri native dialog (Win32 TaskDialog) çağırır.
// - Lazy import dialog + i18n; circular dep riskini ve startup chunk yükünü
//   minimize eder.
// - `runningOnly` modda exit edilmiş veya idle pane'ler hızlı kapanır
//   (welcome / log stream / AI chat gibi PTY'siz pane'ler dahil).

import type { LeafNode, Tab } from '@/types/pane';
import { listLeaves } from '@/types/pane';
import { useSettingsStore } from '@/stores/settings';

function hasShift(e?: MouseEvent | KeyboardEvent | null): boolean {
  return !!e && 'shiftKey' in e && e.shiftKey === true;
}

/** Pane kapatma için kullanıcı onayı al. `true` → kapatabilirsin. */
export async function confirmPaneClose(
  leaf: LeafNode,
  triggerEvent?: MouseEvent | KeyboardEvent | null,
): Promise<boolean> {
  if (hasShift(triggerEvent)) return true;
  const settings = useSettingsStore();
  const mode = settings.state.confirmOnClose;
  if (mode === 'never') return true;
  const isRunning = leaf.status === 'running' && !!leaf.ptyId;
  if (mode === 'runningOnly' && !isRunning) return true;
  const [{ confirmAsk }, { i18n }] = await Promise.all([
    import('@/utils/dialog'),
    import('@/main'),
  ]);
  const t = i18n.global.t.bind(i18n.global);
  const message = isRunning
    ? t('pane.closeRunningConfirm', { title: leaf.title || t('pane.untitled') })
    : t('pane.closeConfirm');
  return confirmAsk(message, { kind: 'warning' });
}

/** Tab kapatma için kullanıcı onayı al. Tab'daki tüm running pane sayısı
 *  message'a eklenir; 0 ise sade tab close konfirmu (mode `always`'da). */
export async function confirmTabClose(
  tab: Tab,
  triggerEvent?: MouseEvent | KeyboardEvent | null,
): Promise<boolean> {
  if (hasShift(triggerEvent)) return true;
  const settings = useSettingsStore();
  const mode = settings.state.confirmOnClose;
  if (mode === 'never') return true;
  const leaves = listLeaves(tab.tree.root);
  const running = leaves.filter((l) => l.status === 'running' && !!l.ptyId).length;
  if (mode === 'runningOnly' && running === 0) return true;
  const [{ confirmAsk }, { i18n }] = await Promise.all([
    import('@/utils/dialog'),
    import('@/main'),
  ]);
  const t = i18n.global.t.bind(i18n.global);
  const message =
    running > 0
      ? t('tab.closeRunningConfirm', { name: tab.name, count: running })
      : t('tab.closeConfirm', { name: tab.name });
  return confirmAsk(message, { kind: 'warning' });
}
