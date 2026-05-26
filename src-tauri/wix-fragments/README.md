# WiX Fragments

Bu dizin, Tauri 2 WiX (MSI) build'ine eklenebilen **opsiyonel** WiX
fragment'lerini içerir. MSI build'inde regression riski oluşturmamak için
fragment'ler `tauri.conf.json`'da **register edilmemiştir** — kullanım için
explicit opt-in gerekir.

## Mevcut fragment'ler

| Dosya | Amaç | Status |
|---|---|---|
| `msix-bridge.wxs` | MSIX Packaging Tool için sandbox-aware metadata + registry virtualization hint'i | ⏸ Scaffold (Task#2 sonrası aktif) |

## Aktivasyon (Partner Center identity reservation sonrası)

`src-tauri/tauri.conf.json`'da:

```jsonc
{
  "bundle": {
    "windows": {
      "wix": {
        "language": ["en-US", "tr-TR"],
        "bannerPath": "installer/wix-banner.bmp",
        "dialogImagePath": "installer/wix-dialog.bmp",
        "fragmentPaths": ["wix-fragments/msix-bridge.wxs"]   // ← bunu ekle
      }
    }
  }
}
```

Sonra `pnpm tauri build` ile MSI yeniden üretilir. Üretilen MSI içinde
`HKCU\SOFTWARE\D-Brand\D-Terminal` registry değerleri eklenir; MSIX wrap'te
sandbox virtualization bu key'i `Packages\<id>\RegistryUser\Local Settings\...`
altına yönlendirir.

## Test prosedürü (aktivasyon sonrası)

```powershell
# 1. MSI build edildikten sonra dosya boyutu eskisiyle benzer mi
Get-ChildItem src-tauri/target/release/bundle/msi/*.msi | Select-Object Name, Length

# 2. MSI içinde registry component'ı var mı (msiexec /a admin install testi)
msiexec /a "D-Terminal_X.Y.Z_x64_en-US.msi" /qb TARGETDIR="C:\msi-extract"
# Üretilen registry tablosunu kontrol et — Orca veya InstEd ile

# 3. Lokal install + registry verification
Start-Process msiexec.exe -ArgumentList "/i", "D-Terminal_X.Y.Z_x64_en-US.msi", "/qb" -Wait
Get-ItemProperty -Path HKCU:\SOFTWARE\D-Brand\D-Terminal
# Channel = "github-releases", License = "GPL-3.0-or-later" görünmeli
```

## Geri alma

Fragment kırılma yaratırsa `tauri.conf.json` → `fragmentPaths` satırını sil
+ `cargo clean -p d-terminal` sonra MSI normale döner. Fragment dosyaları
silmeye gerek yok — sadece reference kaldırılır.

## Referanslar

- [docs/store/appx-config.md](../../docs/store/appx-config.md) — MSIX wrap mimari notları
- [docs/store/msix-build-guide.md](../../docs/store/msix-build-guide.md) — Step-by-step build
- [WiX 3 docs](https://wixtoolset.org/docs/v3/) — Tauri 2 WiX 3 kullanıyor
- [MSIX Desktop-to-UWP](https://learn.microsoft.com/en-us/windows/msix/desktop/desktop-to-uwp-prepare)
