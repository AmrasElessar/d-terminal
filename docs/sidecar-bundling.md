# Sidecar Bundling

D-Terminal'in PTY köprüsü Node.js çalışıyor (`sidecar/pty-bridge.js`). Geliştirme sırasında sistemin Node runtime'ı kullanılır; **production build için Node bağımlılığı kullanıcıdan istenmez** — sidecar tek dosyalık native binary olarak paketlenir.

Bkz. [ADR-0001 — PTY Sidecar IPC Protokolü](./adr/0001-pty-sidecar-ipc-protocol.md).

## Strateji

Tauri v2 `externalBin` mekanizması binary'i bundle'a dahil eder ve runtime path'i platform için doğru hedeflenir. `tauri.conf.json` zaten bu konfigürasyonu içerir:

```json
"externalBin": ["binaries/dterminal-pty-bridge"]
```

Tauri otomatik olarak hedef triple suffix'ini ekler:
`binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe`

## Binary üretimi

İki yaygın araç:

### 1. `@yao-pkg/pkg` (önerilen — `vercel/pkg` fork'u, aktif bakımda)

```bash
cd sidecar
npm install --save-dev @yao-pkg/pkg
npx pkg pty-bridge.js \
  --targets node20-win-x64 \
  --output ../src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe
```

Avantajlar:
- Tek dosya, ~40-50 MB (Node v8 snapshot dahil)
- node-pty native modülü otomatik dahil edilir
- Hızlı startup (~50ms)

Dezavantajlar:
- node-pty `.node` binary'sini paket içinde extract etmesi gerekiyor (pkg bunu otomatik yapar ama `--public` flag'i gerekebilir)

### 2. `nexe`

```bash
cd sidecar
npm install --save-dev nexe
npx nexe pty-bridge.js \
  --target windows-x64-20.10.0 \
  --output ../src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe
```

Daha yavaş build, ama daha küçük binary üretebilir (custom Node build).

## node-pty native modül sorunu

`node-pty` Windows'ta `winpty.dll` ve `conpty.dll`'e bağlanır. ConPTY API Windows 10 1809+'da yerleşik gelir, ek dağıtım gerekmez. Eski Windows'lar için winpty fallback'ini bundle'a eklemek istersen:

```bash
# winpty binary'lerini sidecar/ altına kopyala — pkg bunları toplar
cp node_modules/node-pty/build/Release/winpty*.dll sidecar/
```

## Build sırası

```bash
# 1. Sidecar'ı binary'e çevir
cd sidecar && npx pkg pty-bridge.js \
  --targets node20-win-x64 \
  --output ../src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe

# 2. Tauri build
cd .. && pnpm tauri:build
```

`src-tauri/binaries/` klasörü `.gitignore`'da; binary'ler her CI run'ında üretilir.

## CI entegrasyonu

`.github/workflows/release.yml` içinde sidecar binary üretim adımı eklemen gerekir. Önerilen sıra:

```yaml
- name: Sidecar install + bundle
  working-directory: sidecar
  run: |
    npm install --omit=dev
    npm install --no-save @yao-pkg/pkg
    npx pkg pty-bridge.js --targets node20-win-x64 --output ../src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe

- name: Tauri build
  run: pnpm tauri:build
```

## Alternatif: Node embed yerine Rust port

Uzun vadede `portable-pty` (Rust crate) kullanarak sidecar'ı tamamen Rust'a taşımak mümkün. Kazanım:
- Tek binary, ekstra Node katmanı yok
- ~5-10 MB daha küçük
- Daha hızlı startup

Maliyet:
- node-pty'nin Windows ConPTY entegrasyonu daha olgun, edge case'ler test edilmiş
- Rust port'u v1.1+ scope, MVP'yi geciktirmemeli

Karar: **v1.0'da Node sidecar + pkg, v2.0'da Rust port değerlendir.**

## Dev modu

Geliştirmede `cargo run` çağrıldığında `lib.rs::resolve_sidecar_path()` repo'daki `sidecar/pty-bridge.js`'i bulup `node` ile çalıştırır. Binary üretimi gerekmez, hot-reload Vite tarafında.

## Smoke test

Binary üretim sonrası elle test:

```bash
echo -ne "\x00\x00\x00\x00\x07\x00\x00\x00\x00\x00\x00\x00\x00" | \
  ./src-tauri/binaries/dterminal-pty-bridge-x86_64-pc-windows-msvc.exe
```

(13 byte: zero payload + PING type + zero pane_id) → sidecar PONG ile yanıtlamalı (stdout'a 13 byte). Stdin kapanınca temiz çıkış.

Otomatik test için: `sidecar/tests/protocol.test.js` zaten frame protokolünü doğruluyor; pkg ile derlenmiş binary için ek bir round-trip test ekleyebilirsin.
