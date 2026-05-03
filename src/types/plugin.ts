// Plugin sistemi — ADR-0004 (Web Worker + capability-based permissions).
//
// Bu dosya v1.1+ plugin yükleyicisi için type/protocol tanımlarını içerir.
// Runtime loader (`@/plugins/host.ts`) skeleton aşamasında — gerçek Worker
// spawn ve permission UI v1.1 release ile gelecek.
//
// Tasarım hedefleri:
//  - Plugin'ler izole Web Worker'da çalışır (DOM erişimi YOK).
//  - Render etmeleri gereken UI parçası: Vue sanal node ağacı (capability
//    `ui.virtualDom`). Host onu render eder; plugin doğrudan DOM'a dokunamaz.
//  - Her capability ayrı izin ister. Manifest'te liste, kurulumda kullanıcı onayı,
//    yüksek riskli capability'ler için runtime prompt.
//  - Host-plugin iletişimi tek tip: postMessage(JSON-serializable).

export type PluginCapability =
  // Düşük risk
  | 'pane.read.title'         // pane başlığı oku
  | 'theme.read'              // aktif tema oku
  | 'settings.read.public'    // kullanıcı tercihleri (key/font/dil) oku
  | 'ui.virtualDom'           // host'a virtual DOM ağacı gönder, host render eder

  // Orta risk
  | 'pane.observe.output'     // PTY stdout'u stream et (sadece izleme)
  | 'history.read'            // komut geçmişine bak
  | 'snippet.read'            // snippet'lara bak
  | 'block.read'              // block tracker verisini oku

  // Yüksek risk (runtime prompt)
  | 'pane.write.input'        // PTY stdin'e komut gönder
  | 'pane.create'             // yeni pane aç
  | 'snippet.write'           // snippet ekle/sil
  | 'storage.kv'              // plugin-private SQLite KV erişimi
  | 'network.fetch'           // dış HTTP isteği (allowlist host)
  | 'ai.suggest'              // AI provider'ı çağır (kullanıcının key'i ile)
  ;

/** Plugin'in ne zaman çağrılacağını söyleyen hook listesi.
 *  Hook handler'ları async olabilir, host timeout ve cancel uygular. */
export type PluginHook =
  | 'app.ready'
  | 'pane.opened'
  | 'pane.closed'
  | 'pane.focused'
  | 'command.run'             // OSC 133 'C' tetiklendiğinde
  | 'command.completed'       // OSC 133 'D' (exit code ile)
  | 'theme.changed'
  | 'block.captured'          // yeni block kaydedildiğinde
  ;

export interface PluginManifest {
  /** Reverse-DNS unique id, örn. `dev.dbrand.example` */
  id: string;
  name: string;
  version: string;            // semver
  /** D-Terminal min/max sürümü — semver range. */
  engines: { dterminal: string };
  description: string;
  author: { name: string; email?: string; url?: string };
  /** İstediği capability'ler. Kurulumda kullanıcı onayı, runtime'da host enforce eder. */
  capabilities: PluginCapability[];
  /** Hangi event'lere abone olacağı. */
  hooks: PluginHook[];
  /** Worker entry path (plugin paketi içinde göreli). */
  entry: string;
  /** İzin verilmiş dış host'lar (`network.fetch` capability ile). */
  networkAllowlist?: string[];
  /** Plugin homepage / repo. */
  url?: string;
  license: string;
}

// --- Host ↔ Plugin protokolü ---

export type HostToPluginMessage =
  | { kind: 'init'; manifest: PluginManifest; granted: PluginCapability[] }
  | { kind: 'event'; hook: PluginHook; payload: unknown }
  | { kind: 'response'; requestId: number; ok: true; result: unknown }
  | { kind: 'response'; requestId: number; ok: false; error: string };

export type PluginToHostMessage =
  | { kind: 'ready' }
  | { kind: 'request'; requestId: number; capability: PluginCapability; method: string; args: unknown[] }
  | { kind: 'render'; targetId: string; vnode: PluginVNode }
  | { kind: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string };

/** Sanal DOM ağacı — sadece statik elementler ve text. Event handler'lar
 *  pluginden host'a `request` mesajı tetikler (XSS imkânsız: plugin doğrudan
 *  DOM'a script enjekte edemez, host innerHTML kullanmaz). */
export interface PluginVNode {
  tag: 'div' | 'span' | 'p' | 'pre' | 'code' | 'button' | 'ul' | 'li' | 'a';
  text?: string;
  attrs?: Record<string, string | number | boolean>;
  on?: { click?: string; }; // host'a request olarak gider
  children?: PluginVNode[];
}

/** Capability ile ilişkili runtime prompt politikası. */
export const PERMISSION_POLICY: Record<
  PluginCapability,
  { risk: 'low' | 'medium' | 'high'; promptPerUse: boolean }
> = {
  'pane.read.title':       { risk: 'low',    promptPerUse: false },
  'theme.read':            { risk: 'low',    promptPerUse: false },
  'settings.read.public':  { risk: 'low',    promptPerUse: false },
  'ui.virtualDom':         { risk: 'low',    promptPerUse: false },
  'pane.observe.output':   { risk: 'medium', promptPerUse: false },
  'history.read':          { risk: 'medium', promptPerUse: false },
  'snippet.read':          { risk: 'medium', promptPerUse: false },
  'block.read':            { risk: 'medium', promptPerUse: false },
  'pane.write.input':      { risk: 'high',   promptPerUse: true  },
  'pane.create':           { risk: 'high',   promptPerUse: true  },
  'snippet.write':         { risk: 'high',   promptPerUse: true  },
  'storage.kv':            { risk: 'high',   promptPerUse: false },
  'network.fetch':         { risk: 'high',   promptPerUse: true  },
  'ai.suggest':            { risk: 'high',   promptPerUse: true  },
};
