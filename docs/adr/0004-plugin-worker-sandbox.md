# ADR-0004: Plugin Sandbox — Web Worker + Capability-Based Permission API

**Status**: Accepted
**Date**: 2026-05-02
**Author**: Orhan Engin OKAY

## Context

D-Terminal v1.1'de pane plugin'leri (custom renderer'lar) topluluk tarafından yazılabilecek. Bunlar üçüncü taraf TypeScript kodu — kötü niyetli olmasa bile buggy plugin'in ana uygulamayı çökertmemesi, sistem API'lerine sınırsız erişimi olmaması gerekir.

Mimari belgesi 17.3'te "plugin'ler sandboxed çalışır" der ama mekanizma tanımlanmamıştır. Olası seçenekler:
- (A) Renderer process'te Vue komponenti olarak çalıştırma — sandbox yok, plugin DOM'a, diğer komponentlere, fetch API'sine sınırsız erişir
- (B) Web Worker — DOM erişimi yok, ana thread'den izole, postMessage ile bridge
- (C) iframe + sandbox attribute — DOM var ama izole, capability prompt'u browser-like
- (D) WebAssembly — en güçlü izolasyon, ama plugin yazımı zor, Vue/JS dünyasına yabancı

Plugin v1.1 işi olduğu için karar şimdi alınmasa da olur, ancak v1.0'daki host API tasarımını etkiliyor — şimdi netleştirmek MVP'de doğru abstraction sınırını çizer.

## Decision

**Plugin'ler Web Worker içinde çalışır. Host process'le iletişim postMessage üzerinden, capability-based permission API ile.**

### Plugin manifest

```json
{
  "id": "http-pane",
  "name": "HTTP Request Pane",
  "version": "0.1.0",
  "author": "...",
  "entry": "worker.js",
  "permissions": [
    "network:fetch",
    "ui:render",
    "storage:local"
  ],
  "ui": {
    "icon": "icon.svg",
    "title.tr": "HTTP İstek",
    "title.en": "HTTP Request"
  }
}
```

### Permission taksonomisi

| Capability | Açıklama | Risk |
|---|---|---|
| `ui:render` | Pane içinde DOM render edebilir (host'un sunduğu virtual DOM API) | Düşük |
| `network:fetch` | HTTP isteği atabilir (URL whitelist isteğe bağlı) | Orta |
| `storage:local` | Plugin-scoped key-value storage (izolasyon: plugin id ile namespace) | Düşük |
| `secrets:read` | Plugin'e atanmış secret'ı okuyabilir (kendi secret'ı, başkasınınki değil) | Orta |
| `pty:spawn` | Yeni terminal process başlatabilir | **Yüksek** — manuel onay |
| `clipboard:read` | Pano okuma | Orta |
| `clipboard:write` | Pano yazma | Düşük |
| `fs:read` | Dosya okuma (path prompt'lu) | Yüksek |
| `fs:write` | Dosya yazma (path prompt'lu) | **Yüksek** — manuel onay |

Kurulum sırasında permission listesi gösterilir, kullanıcı onaylar. Çalışma sırasında yüksek riskli capability ek runtime prompt ister.

### Host bridge API

Plugin tarafı (Worker context'te):

```typescript
// host bridge global olarak inject edilir
declare const host: {
  request<T>(capability: string, params: object): Promise<T>;
  render(vnode: VNode): void;
  on(event: string, handler: (data: any) => void): void;
  emit(event: string, data: any): void;
};

// Örnek plugin
export default {
  async onMount(ctx) {
    const data = await host.request('network.fetch', { url: 'https://api.example.com' });
    host.render(/* virtual node */);
  },
  onInput(text) { /* ... */ },
};
```

Host tarafı (main thread):

```typescript
// src/plugins/sandbox.ts
class PluginSandbox {
  worker: Worker;
  permissions: Set<string>;

  async handleRequest(capability: string, params: object) {
    if (!this.permissions.has(capability)) {
      throw new PermissionError(capability);
    }
    if (HIGH_RISK.includes(capability)) {
      const ok = await ui.confirmPermission(this.pluginId, capability, params);
      if (!ok) throw new PermissionDenied();
    }
    return await this.dispatch(capability, params);
  }
}
```

### Render protokolü

Plugin DOM'a doğrudan dokunamaz. Bunun yerine `host.render(vnode)` ile virtual node gönderir, host bunu Vue komponenti olarak render eder. Sınırlı vnode tipi:

- `text`, `box`, `button`, `input`, `select`, `pre`, `link`
- `style` allowlist'i (color, padding, margin, display, flex, grid temel öznitelikleri)
- `onclick`, `onchange` event handler'ları postMessage roundtrip ile

XSS imkânsız — plugin script tag injection yapamaz, raw HTML gönderemez.

### Crash izolasyonu

- Worker hata atarsa sadece o plugin pane'i `ERROR` state'e geçer
- Ana uygulama, diğer pane'ler, hatta aynı plugin'in başka instance'ı etkilenmez
- Worker timeout (30s yanıtsızlık) → terminate, "Plugin yanıt vermiyor" UI

### Plugin dağıtımı

- v1.1 başlangıç: GitHub repo'dan manuel `.dpkg` (zip) install
- v1.2: `d-terminal-plugins` registry repo, in-app browse
- İmza zorunlu mu? v1.1'de değil, v2.0'da SignPath benzeri sertifikasyon

## Consequences

### Olumlu
- DOM ve Node API izolasyonu standard browser primitivleri ile (Worker + postMessage), reinventing yok
- Buggy plugin ana uygulamayı çökertemez — Worker scope'unda kalır
- Capability model kullanıcıya görünür, "bu plugin neye erişiyor" sorusu net cevaplanır
- Wasm'a göre plugin yazımı çok daha kolay — JS/TS bilen herkes yazabilir

### Olumsuz / Kabul edilen tradeoff'lar
- Worker spawn maliyeti pane başına ~5-10 MB RAM. 20 plugin pane = 200 MB. Limit konabilir.
- Render virtual node'a kısıtlı → karmaşık UI'lar (chart, canvas) için ek API gerekir
- postMessage roundtrip her render'da JSON serialization → 60fps animasyon için yetersiz olabilir. Ama plugin pane'i nadiren animasyon ister.
- Wasm kadar güçlü değil — Worker yine de saf JS, theoretical CPU side-channel mümkün (pratikte ihmal edilebilir)

### Risk azaltma
- Yüksek riskli capability'ler için runtime prompt — kullanıcı her sefer onaylar
- Plugin storage namespace'i izole — `plugin:http-pane:*` prefix, başka plugin okuyamaz
- Worker CPU/RAM limiti yok (browser API'si vermiyor) ama timeout var — sonsuz döngü tespit edilir
- Audit log: plugin'in çağırdığı her capability log'lanır, kullanıcı "son 7 gün ne yaptı" görebilir

## Alternatifler

### Doğrudan Vue komponenti (sandbox yok)
Reddedildi: Buggy plugin = uygulama çökmesi. Kötü niyetli plugin = credential hırsızlığı. Risk-reward dengesizliği aşırı.

### iframe + CSP sandbox
Reddedildi: iframe içinde xterm.js gibi DOM-yoğun komponent çalıştırmak performans kaybı. Worker daha hafif.

### WebAssembly
Reddedildi (v1.x için): Plugin yazımı zorlaşır, Rust/Go bilenle sınırlanır. Topluluk büyüklüğü açısından kayıp. v2.0+ için "trusted plugin" kategorisi olarak değerlendirilebilir.

### Tauri permission model'ine devretme
Reddedildi: Tauri permission'ları process-level, plugin-level değil. Tüm plugin'ler aynı permission'a sahip olur — granular değil.

## Referanslar

- [MDN: Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)
- [Capability-based security (paper)](https://en.wikipedia.org/wiki/Capability-based_security)
- [VS Code extension host model](https://code.visualstudio.com/api/advanced-topics/extension-host) — benzer izolasyon yaklaşımı
