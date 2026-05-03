// Plugin host — Web Worker spawn + capability enforcement (ADR-0004).
//
// Bu dosya iskelet aşamasında. v1.0/1.0.5'te aktif değil — sadece v1.1
// plugin loader'ı için type-safe köprü ve registry sağlar. Gerçek loader,
// SQLite plugin tablosu ve marketplace UI v1.1 milestone'unda gelir.

import { createLogger } from '@/utils/logger';
import type {
  PluginCapability,
  PluginHook,
  PluginManifest,
  HostToPluginMessage,
  PluginToHostMessage,
} from '@/types/plugin';
import { PERMISSION_POLICY } from '@/types/plugin';

const log = createLogger('plugin-host');

interface LoadedPlugin {
  manifest: PluginManifest;
  granted: PluginCapability[];
  worker: Worker;
  pendingRequests: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

const loaded = new Map<string, LoadedPlugin>();
let nextRequestId = 1;

/** Plugin yüklemesi (v1.1+). Şu an yalnızca yapısal; gerçek validation +
 *  SQLite kayıt + marketplace download v1.1 release'inde implement edilecek. */
export async function loadPlugin(
  manifest: PluginManifest,
  granted: PluginCapability[],
  workerUrl: string,
): Promise<void> {
  if (loaded.has(manifest.id)) {
    log.warn('plugin already loaded', { id: manifest.id });
    return;
  }
  // Granted capability'ler manifest'in istediklerinin alt kümesi olmalı
  const invalid = granted.filter((c) => !manifest.capabilities.includes(c));
  if (invalid.length > 0) {
    throw new Error(`granted contains capabilities not in manifest: ${invalid.join(', ')}`);
  }
  const worker = new Worker(workerUrl, { type: 'module' });
  const plugin: LoadedPlugin = {
    manifest,
    granted,
    worker,
    pendingRequests: new Map(),
  };
  loaded.set(manifest.id, plugin);

  worker.addEventListener('message', (e: MessageEvent<PluginToHostMessage>) => {
    handlePluginMessage(plugin, e.data);
  });
  worker.addEventListener('error', (e) => {
    log.error('plugin worker error', { id: manifest.id, message: e.message });
  });

  send(plugin, { kind: 'init', manifest, granted });
}

export function unloadPlugin(id: string) {
  const p = loaded.get(id);
  if (!p) return;
  p.worker.terminate();
  loaded.delete(id);
}

export function listLoaded(): PluginManifest[] {
  return Array.from(loaded.values()).map((p) => p.manifest);
}

/** Tüm yüklü plugin'lere belirli bir hook event'i yayınla. Hook'a abone
 *  olmayan plugin'lere gönderme — gereksiz IPC'den kaçınmak için. */
export function emitHook(hook: PluginHook, payload: unknown) {
  for (const p of loaded.values()) {
    if (!p.manifest.hooks.includes(hook)) continue;
    send(p, { kind: 'event', hook, payload });
  }
}

function send(p: LoadedPlugin, msg: HostToPluginMessage) {
  p.worker.postMessage(msg);
}

function handlePluginMessage(p: LoadedPlugin, msg: PluginToHostMessage) {
  switch (msg.kind) {
    case 'ready':
      log.info('plugin ready', { id: p.manifest.id });
      break;
    case 'log':
      log[msg.level](`[${p.manifest.id}] ${msg.message}`);
      break;
    case 'request':
      handleCapabilityRequest(p, msg.requestId, msg.capability, msg.method, msg.args);
      break;
    case 'render':
      // v1.1: render queue'ya ekle, host VNode-to-Vue render eder
      log.debug('plugin render request', { id: p.manifest.id, target: msg.targetId });
      break;
  }
}

function handleCapabilityRequest(
  p: LoadedPlugin,
  requestId: number,
  capability: PluginCapability,
  method: string,
  args: unknown[],
) {
  if (!p.granted.includes(capability)) {
    send(p, {
      kind: 'response',
      requestId,
      ok: false,
      error: `capability not granted: ${capability}`,
    });
    return;
  }
  const policy = PERMISSION_POLICY[capability];
  if (policy.promptPerUse) {
    // v1.1: kullanıcıya runtime prompt göster, onay alınınca devam et
    log.warn('high-risk capability requires runtime prompt (skipped in skeleton)', {
      id: p.manifest.id,
      capability,
      method,
    });
    send(p, {
      kind: 'response',
      requestId,
      ok: false,
      error: 'runtime-prompt-not-implemented',
    });
    return;
  }
  // v1.1: capability dispatch table — pane API, theme API, history API vb.
  log.debug('capability request (skeleton)', { capability, method, argsLen: args.length });
  send(p, {
    kind: 'response',
    requestId,
    ok: false,
    error: 'plugin-system-not-yet-active (v1.1+)',
  });
  void nextRequestId;
}
