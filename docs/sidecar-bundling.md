# Sidecar Bundling

D-Terminal'in PTY köprüsü Node.js çalışıyor (`sidecar/pty-bridge.js`). Geliştirme sırasında sistemin Node runtime'ı kullanılır; **production build için Node bağımlılığı kullanıcıdan istenmez** — sidecar tek dosyalık native binary olarak paketlenir.

Bkz. [ADR-0001 — PTY Sidecar IPC Protokolü](./adr/0001-pty-sidecar-ipc-protocol.md).

## Strateji

Tauri v2 `externalBin` mekanizması binary'i bundle'a dahil eder ve runtime path'i platform için doğru hedeflenir. `tauri.conf.json`:

```json
"externalBin": ["binaries/dterminal-pty-bridge"]
```

Tauri hedef triple suffix'ini otomatik ekler:

- `src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe`
- `src-tauri/binaries/dterminal-pty-bridge-aarch64-pc-windows-msvc.exe`

`src-tauri/binaries/` `.gitignore`'dadır; binary'ler her build'de üretilir.

## Binary üretimi — `@yao-pkg/pkg`

Paketleme `@yao-pkg/pkg` ile yapılır (`vercel/pkg`'nin bakımı süren fork'u, `sidecar/package.json` → `devDependencies`). Komutlar **`sidecar/package.json` script'leri** üzerinden çalıştırılır; script'ler `pkg .` kullanır, böylece `package.json` içindeki `"pkg"` bloğu (node-pty prebuild'leri, `lib/`, `cbor-x` asset/script listesi) devreye girer. `npx pkg pty-bridge.js` gibi doğrudan dosya hedefleyen çağrılar bu config'i **yok sayar** ve native modülleri eksik paketler — kullanmayın.

```bash
cd sidecar
npm ci                 # lockfile-exact (pkg devDependency dahil)
npm run bundle:x64     # → ../src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe
npm run bundle:arm64   # → ../src-tauri/binaries/dterminal-pty-bridge-aarch64-pc-windows-msvc.exe
# veya ikisi birden:
npm run bundle:all
```

Notlar:

- ARM64 hedefi `--no-bytecode --public --public-packages "*"` ile derlenir (x64 host'ta ARM64 V8 bytecode üretilemez).
- node-pty 1.x Windows'ta yalnızca **ConPTY** kullanır (Windows 10 1809+ yerleşik). winpty DLL'lerini kopyalamaya gerek yoktur.
- node-pty'nin native dosyaları (`pty.node`, `conpty.dll`, `OpenConsole.exe`) pkg snapshot'ından çalışma anında diske açılır; konum ve doğrulama ayrıntıları için `sidecar/pty-bridge.js` → native extraction bölümüne bakın.

## Build sırası (lokal)

```bash
# 1. Sidecar binary'si
cd sidecar && npm ci && npm run bundle:x64

# 2. Tauri build
cd .. && pnpm tauri build --target x86_64-pc-windows-msvc
```

## CI entegrasyonu

`.github/workflows/release.yml` (build job, her mimari için matrix):

```yaml
- name: Sidecar install (lockfile-exact, with dev deps for pkg)
  working-directory: sidecar
  run: npm ci

- name: Sidecar bundle (pkg standalone exe)
  working-directory: sidecar
  run: npm run ${{ matrix.sidecar_script }}   # bundle:x64 | bundle:arm64
```

Ardından `pnpm tauri build --target <triple>` çalışır. Build job'u updater imza anahtarını görmez; installer'lar ayrı, korumalı bir `publish` job'unda imzalanır (bkz. `release.yml` başındaki güvenlik modeli notu).

CI job'u (`ci.yml` → `sidecar`) yalnızca `npm ci && npm test` çalıştırır; Rust job'ları için `src-tauri/binaries/` altına boş stub dosyalar oluşturulur (Tauri `externalBin` varlık kontrolü).

## Alternatif: Node embed yerine Rust port

Uzun vadede `portable-pty` (Rust crate) kullanarak sidecar'ı tamamen Rust'a taşımak mümkün. Kazanım:
- Tek binary, ekstra Node katmanı yok
- ~5-10 MB daha küçük
- Daha hızlı startup

Maliyet:
- node-pty'nin Windows ConPTY entegrasyonu daha olgun, edge case'ler test edilmiş
- Rust port'u v1.1+ scope

Karar: **v1.0'da Node sidecar + pkg, v2.0'da Rust port değerlendir.**

## Dev modu

Debug build'de (`cargo run` / `pnpm tauri dev`) bundled binary bulunamazsa `lib.rs::resolve_sidecar_path()` repo'daki `sidecar/pty-bridge.js`'i `node` ile çalıştırır. Bu fallback yalnızca debug build içindir; release build'de bundled sidecar zorunludur.

## Smoke test

Binary üretim sonrası elle test:

```bash
echo -ne "\x00\x00\x00\x00\x07\x00\x00\x00\x00\x00\x00\x00\x00" | \
  ./src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe
```

(13 byte: zero payload + PING type + zero pane_id) → sidecar önce `HELLO`, ardından PONG ile yanıtlamalı. Stdin kapanınca temiz çıkış.

Otomatik test: `sidecar/tests/protocol.test.js` frame protokolünü doğrular (`cd sidecar && npm test`).
