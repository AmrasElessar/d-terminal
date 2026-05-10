# Geliştirme Ortamı Kurulumu

D-Terminal'i yerelde derleyip çalıştırmak için gerekenler.

## Sistem Gereksinimleri

- **Windows 10 1809+** veya **Windows 11** (ConPTY + WebView2)
- **Node.js 20+**
- **pnpm 9.15.0** (package.json `packageManager` alanı ile pin'lenmiş; `corepack enable` veya manuel: `npm install -g pnpm@9.15.0`)
- **Rust stable** (rustup ile)
- **WebView2 Runtime** (Win11'de yerleşik; Win10'da otomatik kurulur)
- **Visual Studio Build Tools 2019+** (C++ workload — Tauri/Rust derleme için)

## Tek Seferlik Kurulum

### 1. Rust Toolchain

```powershell
# Önerilen: winget ile
winget install Rustlang.Rustup

# Sonra (yeni terminal açıp):
rustup default stable
rustup target add x86_64-pc-windows-msvc
```

Alternatif: [https://rustup.rs/](https://rustup.rs/) → `rustup-init.exe` indir, çalıştır.

### 2. Visual Studio Build Tools

Tauri Windows'ta MSVC linker bekler. Yoksa:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools --silent --override "--wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

veya: [https://aka.ms/vs/17/release/vs_BuildTools.exe](https://aka.ms/vs/17/release/vs_BuildTools.exe) → **C++ build tools** workload.

### 3. WebView2 Runtime

Win10/11'de muhtemelen yüklü. Kontrol:

```powershell
Get-AppxPackage *WebView2*
```

Yoksa: [https://developer.microsoft.com/microsoft-edge/webview2/](https://developer.microsoft.com/microsoft-edge/webview2/) → Evergreen Standalone Installer.

### 4. Repo Bağımlılıkları

```bash
git clone https://github.com/AmrasElessar/d-terminal.git
cd d-terminal
pnpm install
cd sidecar && npm install && cd ..
```

## Geliştirme Komutları

```bash
# Vite dev server + Tauri penceresi (hot reload)
pnpm tauri:dev

# Sadece frontend (Tauri olmadan, browser'da test)
pnpm dev

# TypeScript tip kontrolü
pnpm exec vue-tsc --noEmit

# Vite production build
pnpm build

# Sidecar testleri
cd sidecar && npm test

# Rust testleri
cd src-tauri && cargo test

# Rust format + lint
cd src-tauri && cargo fmt && cargo clippy -- -D warnings

# Production build (MSI + NSIS installer)
pnpm tauri:build
```

## Hızlı Smoke Test

```bash
pnpm tauri:dev
```

Beklenen: WebView2 penceresi açılır, D-Terminal başlığı görünür, karşılama paneli + DFetch sistem bilgisi gelir. **Ctrl+Shift+T** → yeni pane diyaloğu, PowerShell seçildiğinde çalışan bir shell.

## CI Replikasyonu

PR push'tan önce yerelde tüm kontrolleri çalıştır:

```bash
pnpm exec vue-tsc --noEmit && \
pnpm build && \
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test && cd .. && \
cd sidecar && npm test && cd ..
```

## Sık Karşılaşılan Sorunlar

| Sorun | Çözüm |
|---|---|
| `cargo: command not found` | Rust kurulu değil — yukarıdaki adım 1 |
| `link.exe not found` | VS Build Tools eksik — adım 2 |
| `WebView2Loader.dll missing` | WebView2 Runtime eksik — adım 3 |
| Tauri build sırasında `node-pty` rebuild fail | `cd sidecar && npm rebuild` |
| `pnpm install` ESBuild script uyarısı | İhmal edilebilir; istersen `pnpm approve-builds` |
| ConPTY problemi (Win10 < 1809) | OS güncelle veya WSL kullan |

## VS Code Önerilen Eklentiler

- **Vue.volar** — Vue 3 + TypeScript
- **rust-lang.rust-analyzer** — Rust LSP
- **tauri-apps.tauri-vscode** — Tauri komutları
- **dbaeumer.vscode-eslint** — JS/TS lint
- **esbenp.prettier-vscode** — Format
