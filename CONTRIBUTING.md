# Katkı Rehberi — D-Terminal

D-Terminal'e katkıda bulunmak istediğin için teşekkürler! Bu rehber katkı sürecini açıklar.

## Katkı Türleri

| Tür | Detay | Sürüm |
|---|---|---|
| 🐛 Bug report | GitHub Issues | her zaman |
| 💡 Feature request | GitHub Issues + Discussion | her zaman |
| 🌍 Dil paketi | `/src/locales/<kod>.json` | v1.0+ |
| 🎨 Tema | `themes/` veya `d-terminal-themes` repo'su | v1.0+ |
| 🤖 AI provider adapter | `/src/providers/` altında yeni dosya | v1.0+ |
| 🧩 Plugin | Plugin API (Web Worker sandbox) | v1.1+ |
| 📝 Dokümantasyon | `docs/` altında | her zaman |
| 🔧 Kod (PR) | Aşağıdaki süreç | her zaman |

## Geliştirme Ortamı

### Gereksinimler

- **Node.js** 20.x+
- **pnpm** 9.x+ (npm/yarn değil)
- **Rust** stable (rustup ile)
- **Windows 10 1511+** (Tauri v2 hedefi)
- **WebView2 Runtime** (Win11'de yüklü gelir)

### Kurulum

```bash
# Klonla
git clone https://github.com/<user>/d-terminal.git
cd d-terminal

# Bağımlılıkları yükle
pnpm install

# Sidecar bağımlılıkları
pnpm --filter ./sidecar install

# Geliştirme modunda çalıştır
pnpm tauri dev
```

## Kod Standartları

### TypeScript / Vue

- **Strict mode**: `any` yasak
- **Composition API only** (Options API kullanma)
- Komponent max 300 satır — büyürse parçala
- Pinia store max 200 satır
- ESLint + Prettier, commit öncesi otomatik (husky)

### Rust

- `cargo fmt` + `cargo clippy -- -D warnings`
- `unsafe` yasak — istisna sadece `windows-rs` FFI çağrılarında, yorumlu
- `cargo test` ile yeni kod test edilmeli

## Test

PR merge için:

- Unit test coverage düşmemeli (hedef ≥ %70)
- E2E testlerin hepsi geçmeli
- Performance budget aşılmamalı

```bash
pnpm test          # Vitest (TS)
pnpm test:e2e      # Playwright
cd src-tauri && cargo test
```

## PR Süreci

1. Issue aç (önce tartış, sonra kod) — küçük fix için skip edilebilir
2. Fork + feature branch (`feat/<kısa-açıklama>` veya `fix/<kısa-açıklama>`)
3. Commit mesajları: [Conventional Commits](https://www.conventionalcommits.org/)
   - `feat: add ollama provider`
   - `fix: pty resize race condition`
   - `docs: update ADR-0002 risk note`
4. PR aç — template'i doldur
5. CI yeşil olmalı
6. Review (maintainer onayı)
7. Squash + merge

## Yeni AI Provider Ekleme

```typescript
// src/providers/<provider-name>.ts
import { AIProvider } from './types';

export class MyProvider implements AIProvider {
  name = 'my-provider';

  async *chat(messages, options) {
    // OpenAI-compat REST veya native SDK
    // yield string chunks
  }

  async models() { /* ... */ }
  async isAvailable() { /* ... */ }
}
```

`src/providers/registry.ts` içinde register et + test yaz.

## Yeni Tema Ekleme

`themes/` klasörüne JSON ekle ([architecture-v1.1.md §6.1](./docs/architecture-v1.1.md#61-tema-json-yapısı) şemasına uygun). Topluluk temaları için ayrı `d-terminal-themes` repo'sunu kullan.

## Yeni Dil Paketi

`src/locales/en.json` dosyasını referans al, `<kod>.json` olarak kopyala, çevir. Eksik key'ler EN'e fallback eder, ama %80+ tamamlanmamış dosya merge edilmez.

## Plugin Geliştirme (v1.1+)

[ADR-0004](./docs/adr/0004-plugin-worker-sandbox.md) — plugin sandbox modelini açıklar. Plugin yazımı için ayrı `PLUGIN_API.md` v1.1 ile birlikte yayınlanacak.

## ADR (Architecture Decision Record) Yazma

Mimari değişiklik öneriyorsan:

1. `docs/adr/template.md` kopyala
2. `docs/adr/00NN-kebab-case-baslik.md` olarak kaydet
3. PR aç, "Status: Proposed"
4. Tartışma sonrası "Accepted" veya reddedilir

## Davranış Kuralları

Saygılı, yapıcı ve kapsayıcı bir topluluk hedefliyoruz. [Contributor Covenant](https://www.contributor-covenant.org/) prensiplerine uyulması beklenir.

## İletişim

- GitHub Issues: bug, feature
- GitHub Discussions: genel sohbet, soru
- Email (kritik güvenlik açığı): security@d-terminal.dev *(v1.0 ile aktifleşir)*

---

Teşekkürler! 💙
