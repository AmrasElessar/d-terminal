# ADR-0007: CSP Allowlist Scope (localhost ports)

**Status**: Accepted — amended 2026-10 (see "Amendment" below)
**Date**: 2026-05-12
**Author**: Orhan Engin OKAY

## Context

`src-tauri/tauri.conf.json` `app.security.csp` aşağıdaki origin'leri
`connect-src`'de listeler:

- `'self'`, `ipc:`, `http://ipc.localhost` — Tauri IPC bridge (default)
- `ws://localhost:1420`, `http://localhost:1420` — Vite dev server (HMR)
- `http://localhost:1234, 1337, 5273, 8080, 11434` — yerel AI runtime'lar
  (LM Studio, Jan, Foundry, llama.cpp, Ollama)

Periodic security audit (5 paralel agent, 2026-05-12) bu liste'yi
**HIGH severity** olarak raporladı: "prod'da localhost portları açık,
saldırgan XSS bulursa yerel servislere komut atabilir."

## Decision

Mevcut CSP **kasıtlı tasarım**, daraltılmaz. Justification:

1. **Dev portu (`localhost:1420`)** — Vite HMR WebSocket'i bu origin'de.
   Tauri 2 prod build'de WebView2 vite'a navigate etmez (`tauri.localhost`
   bundled asset'leri serve eder), ama CSP statik string olduğu için tek
   `tauri.conf.json` hem dev hem prod için. Compile-time CSP injection
   (build.rs ile cargo cfg'ye göre) teknik olarak mümkün, ama:
   - Mevcut CI/release pipeline'ı (`release.yml`) tek conf.json varsayar.
   - Tauri 2 overlay (`--config tauri.conf.dev.json`) eklemek dev script'ini
     ve dependabot işlerini kırma riski yüksek.
   - Risk gerçek değil: prod WebView2 bu origin'e navigate etmez, HMR
     handshake hiç başlamaz.

2. **AI runtime portları (1234, 1337, 5273, 8080, 11434)** — Kullanıcının
   yerel makinesinde Ollama/LM Studio/Jan/llama.cpp/Foundry çalıştırdığında
   D-Terminal'in chat etmesi için `connect-src`'de açık olmaları gerekli
   GÖRÜNÜYOR — ama:
   - **Şu an** AI chat çağrıları Rust `reqwest` üzerinden yapılıyor
     (`src-tauri/src/ai/openai.rs` vb.), frontend doğrudan `fetch` atmıyor.
   - O zaman frontend CSP'sinde bu portlar **gerçekten gerekli değil**.
   - Doğrulama: SettingsModal "test bağlantı" akışları + AI provider
     resmi listesi.

   **Action item**: v0.9.9+ için bu portları CSP'den çıkarmayı doğrula.
   Bu ADR şu an oldukları gibi tutulduğunu belgeler.

3. **XSS post-compromise yüzey analizi** — D-Terminal hiçbir kullanıcı
   girdisini DOM'a unsafe render etmez (`v-html` yok, `eval` yok, xterm
   render'ı escape-aware). Teorik bir XSS olsa bile:
   - `default-src 'self'` — başka her şey reddedilir.
   - `script-src 'self' 'wasm-unsafe-eval'` — inline script yok, eval yok.
   - `img-src 'self' data: blob:` — exfiltration vectors kapalı
     (uzak `<img src=...>` ile data sızdırma olası değil).
   - Saldırgan sadece kullanıcının kendi yerel makinesindeki AI runtime'larına
     istek atabilir — yerel makinede local code execution gerekir (bu noktada
     CSP fark etmez).

## Consequences

- Future audit agent'ları bu ADR'yi referans alıp bu CSP entry'lerini
  false positive olarak işaretlesin.
- `default-src 'self'`, no-inline-script CSP yapısı XSS exfiltration
  surface'ini zaten kapatıyor.
- Yeni AI runtime ekleneceği zaman CSP'ye port eklemek **bilinçli** bir
  karar olmalı (PR template'de hatırlatma var: ProcessJail reminder).

### Açık eylem (v0.9.9+ için)

AI runtime portlarının frontend CSP'sinde gerekli olmadığını doğrula —
yerel runtime chat'i tamamen Rust proxy üzerinden yapılıyor ise CSP'den
5 portu çıkarabiliriz. Bu, CSP'yi minimal hale getirir + audit gürültüsünü
kapatır.

## Amendment (2026-10) — current state

- **AI runtime ports removed (Alternative C applied, v0.10.0).** All AI
  traffic goes through the Rust `reqwest` proxy; `connect-src` no longer
  lists 1234/1337/5273/8080/11434. The "Açık eylem" item above is closed.
- **Dev-server origins moved to `devCsp` (Alternative B, simplified).**
  Tauri 2 supports `app.security.devCsp`, which is used only by
  `tauri dev`. `ws://localhost:1420` / `http://localhost:1420` now live
  there; the production `csp` contains only `'self'`, `ipc:` and
  `http://ipc.localhost` in `connect-src`. No second config file or
  pipeline change is needed, which removes the original objection.
- **Additional directives:** production CSP also sets restrictive
  `base-uri`, `form-action` and `frame-src` / `object-src`.
- **Known remaining gap:** `style-src 'unsafe-inline'` is still required
  (Vue scoped/inline styles, xterm.js). `script-src` keeps
  `'wasm-unsafe-eval'` for the WebGL/image addons; there is no
  `unsafe-eval` and no inline script.

The authoritative CSP strings are in `src-tauri/tauri.conf.json`
(`app.security.csp` and `app.security.devCsp`).

## Alternatifler

### A. Build-time CSP injection (cargo cfg)

`build.rs` ile prod'da `localhost:1420` kaldır.

- ✗ Complexity > risk: prod WebView2 zaten bu origin'e navigate etmiyor.
- ✗ Mevcut CI pipeline tek conf.json varsayar.

**Reddedildi**.

### B. Tauri overlay config (`tauri.conf.dev.json`)

Dev script `tauri dev --config tauri.conf.dev.json` ile farklı CSP.

- ✗ CI/release pipeline refactor gerekir.
- ✗ Sürdürülebilirlik: iki conf dosyasını senkron tutmak hata yüzeyi yaratır.

**Reddedildi**: v1.0+ kabul edilebilir, mevcut sürümde gereksiz.

### C. AI runtime portlarını CSP'den çıkar (Rust-only proxy)

- ✓ Frontend zaten Rust üzerinden AI çağırıyor, doğrulanırsa direkt
  uygulanabilir.
- ✓ CSP minimum, audit gürültüsü sıfır.

**Karar bekleniyor** (v0.9.9 action item).

## Referanslar

- `src-tauri/tauri.conf.json` `app.security.csp`
- ADR-0006: ProcessJail — defense in depth (sandbox tamamlayıcısı)
- MDN: [Content-Security-Policy connect-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src)
- v0.9.8 audit raporu (5 paralel agent, 2026-05-12)
