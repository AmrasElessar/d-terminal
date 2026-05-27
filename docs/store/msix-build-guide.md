# D-Terminal — MSIX Build & Submission Guide

> **Amaç:** D-Terminal MSI installer'ını Microsoft Store'a uygun MSIX paketine wrap etmek için step-by-step rehber.
> **Hedef:** MS Store submission'a hazır, lokal test edilmiş `.msix` paketi.
> **Son güncelleme:** 2026-05-27 (v0.10.0 release sonrası)
>
> **İlgili dokümanlar / Related docs:**
> - [`appx-config.md`](appx-config.md) — Tauri 2 + AppX araştırma notları
> - [`code-signing.md`](code-signing.md) — SignPath/Azure/EV cert seçenekleri
> - [`identity-migration.md`](identity-migration.md) — v0.9.x → Store veri aktarımı (migration wizard)
> - [`listing.md`](listing.md) — Store metin/screenshot/kategori
> - [`submission-checklist.md`](submission-checklist.md) — submission öncesi tek-noktada checklist

---

## 🇹🇷 Türkçe

### 1. Neden MSIX, neden MSI değil

| Özellik | MSI (mevcut GitHub Releases) | MSIX (Store) |
|---|---|---|
| Dağıtım | GitHub Releases | Microsoft Store + opsiyonel GitHub |
| Code signing | Manuel (SignPath/EV) | Store kendi cert'iyle imzalar |
| Auto-update | Tauri updater (`latest.json`) | Microsoft Store updater |
| Kurulum yetkisi | Admin/UAC gerekli | Standart kullanıcı |
| Sandbox | Yok — `%APPDATA%\D-Terminal` | VFS redirection (opsiyonel) |
| SmartScreen | İmzasız → "Unknown publisher" | Microsoft'un imzası → uyarı yok |
| Uninstall temizliği | MSI uninstall'a güvenir | Garantili clean uninstall |

**Sonuç:** İki kanal paralel ilerler. MSIX yeni kullanıcılar için tercih edilir; teknik kullanıcı / kurum içi dağıtım MSI ile devam eder.

---

### 2. Ön koşullar

Aşağıdakiler **bu rehbere başlamadan önce** tamamlanmış olmalı:

- [ ] **Partner Center hesabı açık** ([`submission-checklist.md` #1](submission-checklist.md))
- [ ] **App identity reserve edildi** — Package Name + Publisher CN + Display Name not alındı ([#2](submission-checklist.md))
- [ ] **MSI build üretiliyor** — `pnpm tauri build` ile `D-Terminal_<ver>_x64_tr-TR.msi` çıkıyor (CI'da ✅)
- [ ] **MSIX Packaging Tool kuruldu** — Store'dan veya [doğrudan link](https://www.microsoft.com/en-us/p/msix-packaging-tool/9n5lw3jbcxkf)
- [ ] **Windows 10 1809+ veya Windows 11** (MSIX yalnız bu sürümlerden destekli)
- [ ] **Windows SDK 10.0.22000+ kuruldu** — `signtool.exe`, `makeappx.exe` için ([İndir](https://developer.microsoft.com/en-us/windows/downloads/windows-sdk/))

**Opsiyonel ama önerilir:**
- [ ] Yedek alma — temiz Windows VM (Hyper-V veya Sandbox) MSIX testi için izole ortam

---

### 3. Adım 1 — Partner Center identity'i `tauri.conf.json`'a yansıt

> ⚠️ **Şu an `tauri.conf.json`'da publisher placeholder.** Identity reservation tamamlandığında aşağıdaki alanları **manuel** güncelle.

```jsonc
// src-tauri/tauri.conf.json
{
  "bundle": {
    // Partner Center'dan gelen değerler:
    "publisher": "AmrasElessar",                       // Publisher Display Name
    "identifier": "12345AmrasElessar.DTerminal",       // Package Family Name'in ID kısmı
    "windows": {
      "wix": {
        // MSIX wrap'in WiX metadata'sını okuması için fragment'ı aktif et:
        "fragmentPaths": ["wix-fragments/msix-bridge.wxs"]
      }
    }
  }
}
```

`wix-fragments/msix-bridge.wxs` zaten scaffold halinde commit'li ([`src-tauri/wix-fragments/msix-bridge.wxs`](../../src-tauri/wix-fragments/msix-bridge.wxs)). Sadece `fragmentPaths` register edildiğinde aktif olur.

---

### 4. Adım 2 — Migration target path'i için MSIX feature flag (kod tarafı)

Backend migration kodu (`storage/migrate_legacy.rs` + `commands/migrate.rs`) hazır ama v0.10.x'te dormant — `legacy_dir == target_dir` olduğu için detect her zaman `None` döner.

MSIX build için target path'i `%LOCALAPPDATA%\Packages\<id>\LocalState` olarak değiştirmemiz gerekir. İki yol:

#### Yol A (önerilen): Cargo feature flag

`src-tauri/Cargo.toml`'a ekle:
```toml
[features]
default = ["custom-protocol"]
custom-protocol = ["tauri/custom-protocol"]
msix = []  # MSIX build'inde aktif: target_dir farklı resolve edilir
```

`src-tauri/src/commands/migrate.rs` içinde:
```rust
fn default_target_dir() -> AppResult<PathBuf> {
    #[cfg(feature = "msix")]
    {
        // MSIX sandbox: AppData\Local\Packages\<id>\LocalState\D-Terminal
        dirs::data_local_dir()
            .map(|p| p.join("Packages").join("12345AmrasElessar.DTerminal").join("LocalState").join("D-Terminal"))
            .ok_or_else(|| AppError::Internal("data_local_dir unresolved".into()))
    }
    #[cfg(not(feature = "msix"))]
    {
        dirs::data_dir()
            .map(|p| p.join("D-Terminal"))
            .ok_or_else(|| AppError::Internal("data_dir unresolved".into()))
    }
}
```

Build komutu: `pnpm tauri build --features msix`

#### Yol B: Runtime detection
`std::env::var("MSIX_PACKAGE_CONTEXT")` veya benzeri (Tauri 2'de doğrudan yok — manuel runtime API'sı yazılması gerekir). Daha kompleks; Yol A yeterli.

> **NOT:** Bu feature flag identity reservation **sonrası** eklenecek. Şimdilik kod path'i yalnızca dokümante; v0.10.x'te no-op.

---

### 5. Adım 3 — MSI build et

```powershell
# Önce frontend + backend tüm test'ler geçsin
pnpm vitest run
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Sonra release build
pnpm tauri build --target x86_64-pc-windows-msvc

# Çıktı:
# src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi\
#   D-Terminal_0.10.0_x64_tr-TR.msi
```

ARM64 için ayrıca: `pnpm tauri build --target aarch64-pc-windows-msvc`

> ⚠️ MSIX wrap **tek architecture** için yapılır. x64 ve ARM64 ayrı MSIX paketleri olur; Store'a ikisini birden yüklersin.

---

### 6. Adım 4 — MSIX Packaging Tool ile MSI'yı wrap et

> 💡 İlk wrap için **temiz Windows VM** kullan. Tool MSI install sırasında dosya değişikliklerini izler; kirli sistemde başka uygulamaların dosya işlemleri ML/manifest'e karışabilir.

#### 4.1 Tool'u başlat
1. Start menüsünden **MSIX Packaging Tool** aç
2. "Create your app package" → **Application package**

#### 4.2 Packaging method seç
- **Create package on this computer** (lokal)
- **Create package on a remote machine** (VM remote control) — temiz ortam için tercih edilir
- **Create package from existing installer** — MSI dosyasını doğrudan vermek için en hızlısı

> En pragmatik: **"Create package from existing installer"** + MSI path olarak `D-Terminal_0.10.0_x64_tr-TR.msi`

#### 4.3 Package information formu

| Alan | Değer |
|---|---|
| **Package name** | `12345AmrasElessar.DTerminal` (Partner Center'dan) |
| **Package display name** | `D-Terminal` |
| **Publisher name (CN)** | `CN=12345AmrasElessar, O=AmrasElessar, ...` (Partner Center) |
| **Publisher display name** | `AmrasElessar` (veya tercih ettiğin isim) |
| **Version** | `0.10.0.0` ⚠️ **4 segment zorunlu, son segment 0** |
| **Package description** | (`listing.md`'den kısa açıklama) |
| **Installer arguments** | `/quiet /norestart` (sessiz install için) |

#### 4.4 Prepare computer
- Tool gerekli OS feature'larını kontrol eder
- Windows Search, Update gibi servisleri **geçici durdurabilir** (file noise'u azaltır)
- "Next" → install monitoring başlar

#### 4.5 MSI installer çalışır
- Tool arka planda dosya/registry değişikliklerini yakalar
- D-Terminal MSI normal akışıyla yüklenir
- Yükleme bittikten sonra "Move to next step"

#### 4.6 First launch tasks (opsiyonel ama önerilir)
- Tool sorduğunda **"Yes, my app needs to make changes on first launch"** seç
- Uygulamayı bir kere aç → migration dialog dahil tüm first-launch davranışlar capture edilir
- Kapat → "Move to next step"

#### 4.7 Manifest review
Tool otomatik manifest üretir. Aşağıdaki alanları doğrula:

```xml
<!-- AppxManifest.xml — kritik alanlar -->
<Identity
  Name="12345AmrasElessar.DTerminal"
  Publisher="CN=12345AmrasElessar, ..."
  Version="0.10.0.0"
  ProcessorArchitecture="x64" />

<Properties>
  <DisplayName>D-Terminal</DisplayName>
  <PublisherDisplayName>AmrasElessar</PublisherDisplayName>
  <Logo>Assets\StoreLogo.png</Logo>
</Properties>

<Dependencies>
  <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22000.0" />
</Dependencies>

<Capabilities>
  <!-- runFullTrust = Win32 process olarak çalışır (Tauri Win32 backend) -->
  <rescap:Capability Name="runFullTrust" />
  <!-- D-Terminal'in capability'leri: -->
  <Capability Name="internetClient" />          <!-- AI provider HTTP calls -->
  <uap:Capability Name="documentsLibrary" />    <!-- snapshot save, log export -->
</Capabilities>
```

> ⚠️ `runFullTrust` **kritik**: D-Terminal PTY spawn, Win32 process control, DPAPI kullanır. Bu capability olmadan çalışmaz. Microsoft submission'da bunun gerekçesini sorabilir — cevap: "Native Windows terminal — shell process management requires Win32 API access (PTY, Job Objects, DPAPI for secret storage)".

#### 4.8 Package output
- "Create" → `.msix` dosyası belirttiğin path'e yazılır
- Önerilen path: `dist/msix/D-Terminal_0.10.0.0_x64.msix`

---

### 7. Adım 5 — Lokal test (self-signed cert)

> Store submission'da imzalama **GEREKLİ DEĞİL** — Microsoft kendi cert'iyle imzalar. Bu adım yalnız **lokal install testi** için.

```powershell
# 1) Self-signed test cert üret
$cert = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=12345AmrasElessar" `
  -KeyUsage DigitalSignature `
  -FriendlyName "D-Terminal MSIX Dev" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

# 2) PFX'e export et (signtool için)
$pwd = ConvertTo-SecureString -String "test1234" -Force -AsPlainText
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
  -FilePath "dterm-dev.pfx" -Password $pwd

# 3) MSIX'i imzala — Subject CN package Publisher ile EŞLEŞMELİ
signtool sign /fd SHA256 /a /f dterm-dev.pfx /p test1234 `
  D-Terminal_0.10.0.0_x64.msix

# 4) Cert'i Trusted Root'a ekle (test için, normalde YASAK)
Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
  -FilePath "dterm-dev.cer"
Import-Certificate -FilePath "dterm-dev.cer" `
  -CertStoreLocation "Cert:\LocalMachine\Root"
# ↑ Admin PowerShell gerekir

# 5) MSIX'i kur
Add-AppxPackage -Path D-Terminal_0.10.0.0_x64.msix

# 6) Test
# Start menüsü → D-Terminal → açılır
# Test bittiğinde:
Remove-AppxPackage -Package "12345AmrasElessar.DTerminal_0.10.0.0_x64__..."

# 7) Cert temizliği (kritik — bu cert PROD'da KULLANILMAZ)
Get-ChildItem "Cert:\LocalMachine\Root" |
  Where-Object { $_.Subject -eq "CN=12345AmrasElessar" } |
  Remove-Item
```

---

### 8. Adım 6 — MSIX paketi doğrula

```powershell
# MSIX manifest'i incele
makeappx unpack /p D-Terminal_0.10.0.0_x64.msix /d unpacked\
# unpacked\AppxManifest.xml açıp manuel review

# Tüm dependency'ler ve dosyalar yerinde mi
Get-ChildItem unpacked\ -Recurse | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum
# Beklenen: ~50-80 MB (D-Terminal v0.10.0 MSI ile uyumlu)

# Windows App Cert Kit (WACK) ile pre-submission test
# %ProgramFiles(x86)%\Windows Kits\10\App Certification Kit\appcertui.exe
# → "Store apps" → MSIX seç → çalıştır → rapor
```

WACK rapor'unda **fail** çıkan kontroller submission'da reddedilir. Yaygın failure'lar:
- **Banned API calls** — Tauri 2 zaten temiz; `runFullTrust` ile zaten exempt
- **App manifest tests** — capability declaration mismatch
- **Security tests** — debug build kalmış (`tauri.conf.json`'da `tauri/devtools` feature kapalı olmalı release'de)

---

### 9. Adım 7 — Store submission

> **Detaylı submission akışı için:** [`submission-checklist.md`](submission-checklist.md)

Özet:
1. Partner Center → Apps & Games → Submit your first app
2. **Pricing & availability** — Free, 200+ market
3. **Properties** — Category: Developer tools, Subcategory: System utilities
4. **Age rating** — IARC questionnaire (3+ Everyone)
5. **Package** — MSIX'i upload et (x64 + ARM64 ayrı upload)
6. **Store listing** — [`listing.md`](listing.md)'den TR + EN metinleri yapıştır
7. **Submit for certification**
8. Microsoft review: **~1-3 iş günü**

---

### 10. Troubleshooting

#### Hata: "Package signature hash does not match the binary content"
- **Sebep:** MSIX imzalandıktan sonra paket içeriği değişti (manifest edit gibi)
- **Çözüm:** Re-sign et (`signtool sign ...` baştan)

#### Hata: "Add-AppxPackage : The root certificate of the signature in the app package or bundle must be trusted"
- **Sebep:** Self-signed cert Trusted Root'a eklenmedi (Adım 5.4)
- **Çözüm:** Admin PowerShell'de `Import-Certificate` ile cert'i ekle. **PROD'da bu adım YOK** — Store imzalı paketleri Microsoft cert'i ile zaten trusted.

#### Hata: "Cannot register the package because the following error was encountered: The system cannot find the file specified"
- **Sebep:** MSIX paketinde dosya eksik veya path yanlış
- **Çözüm:** `makeappx unpack` ile MSIX'i aç, manifest'teki `<Resources>` ve `<Applications>` referansları gerçek dosyalarla eşleşiyor mu kontrol et

#### Hata: WACK "Banned file analyzer" → `.dll` listesi
- **Sebep:** Tauri 2 build içinde Microsoft'un banned listesindeki Windows API'leri kullanan eski DLL kalmış (örn. eski VCRedist)
- **Çözüm:** `cargo update` + `pnpm update`, sonra temiz `pnpm tauri build`

#### Hata: Migration dialog aktif olmuyor (MSIX install sonrası)
- **Sebep:** MSIX feature flag (Adım 4) eklenmemiş, `target_dir == legacy_dir` olmaya devam ediyor
- **Çözüm:** `Cargo.toml`'a `msix` feature ekle, `pnpm tauri build --features msix` ile rebuild

#### Hata: "runFullTrust capability is not allowed"
- **Sebep:** Store reviewer capability gerekçesini sorguluyor
- **Çözüm:** "Notes for certification" alanına ekle: *"D-Terminal is a native Windows terminal emulator requiring Win32 API access for PTY process management, Job Objects for child process lifecycle, and DPAPI for AI API key encryption. These are not available through UWP APIs."*

#### Hata: Build sırasında "publisher CN mismatch"
- **Sebep:** `tauri.conf.json`'da publisher placeholder, MSIX manifest'te gerçek CN — uyuşmuyor
- **Çözüm:** Adım 1'i tamamla — `tauri.conf.json` publisher = Partner Center CN

---

### 11. Versioning kuralı

| Sürüm formatı | GitHub Releases | MSIX |
|---|---|---|
| `v0.10.0` | ✅ | ❌ (3 segment) |
| `v0.10.0.0` | (gereksiz) | ✅ (4 segment zorunlu) |
| `v1.0.0` | ✅ | ❌ (3 segment) |
| `v1.0.0.0` | (gereksiz) | ✅ |

**Strateji:** GitHub'da `vX.Y.Z` semver, MSIX manifest'inde `X.Y.Z.0` (son segment patch için reserve). MSIX submission'da version artırılması zorunlu — aynı version ikinci kez submit edilemez.

---

### 12. CI entegrasyonu

> **Detaylar:** [`/.github/workflows/release-msix.yml`](../../.github/workflows/release-msix.yml) (manual trigger, identity reservation öncesi taslak)

Workflow şu an manual `workflow_dispatch` ile çalışır — kullanıcı identity reserve ettikten sonra trigger atar. Tam otomatik MSIX submission `tag push` ile aktif edilir (v1.0 sonrası).

---

### 13. Maliyet özeti

| Kalem | Tutar | Frekans |
|---|---|---|
| Partner Center (Microsoft) | $19 | Bir kez |
| SignPath FOSS (code signing) | Ücretsiz | ✅ |
| Azure Trusted Signing (alternatif) | $9.99/ay | Aylık |
| Microsoft Store (revenue share) | Free apps için $0 | — |
| **Toplam (D-Terminal için)** | **$19** | **Bir kez** |

---

<details>
<summary>🇬🇧 English version</summary>

### 1. Why MSIX over MSI

| Feature | MSI (current GitHub Releases) | MSIX (Store) |
|---|---|---|
| Distribution | GitHub Releases | Microsoft Store + optional GitHub |
| Code signing | Manual (SignPath/EV) | Store signs with its own cert |
| Auto-update | Tauri updater (`latest.json`) | Microsoft Store updater |
| Install privileges | Admin/UAC required | Standard user |
| Sandbox | None — `%APPDATA%\D-Terminal` | Optional VFS redirection |
| SmartScreen | Unsigned → "Unknown publisher" | Microsoft-signed → no warning |
| Clean uninstall | Depends on MSI uninstaller | Guaranteed clean uninstall |

**Conclusion:** Both channels run in parallel. MSIX preferred for new users; technical/enterprise distribution stays on MSI.

### 2. Prerequisites
- Partner Center account active
- App identity reserved (Package Name + Publisher CN + Display Name noted)
- MSI build pipeline working (`pnpm tauri build` produces `.msi`)
- MSIX Packaging Tool installed ([direct link](https://www.microsoft.com/en-us/p/msix-packaging-tool/9n5lw3jbcxkf))
- Windows 10 1809+ or Windows 11
- Windows SDK 10.0.22000+ (`signtool.exe`, `makeappx.exe`)

### 3-12. (Same flow as Turkish — refer to the Turkish version above; sections are technical and language-agnostic.)

### 13. Cost summary

| Item | Cost | Frequency |
|---|---|---|
| Partner Center (Microsoft) | $19 | One-time |
| SignPath FOSS (code signing) | Free | ✅ |
| Microsoft Store (revenue share) | Free apps: $0 | — |
| **Total for D-Terminal** | **$19** | **One-time** |

</details>

---

## ✅ MSIX Build Checklist

Submit etmeden önce her madde doğrulanmış olmalı:

- [ ] Partner Center identity tauri.conf.json'a yansıtıldı (publisher + identifier)
- [ ] `msix` Cargo feature eklendi (migration target_dir sandbox'a yönlendirir)
- [ ] x64 MSI build başarılı (`pnpm tauri build --features msix --target x86_64-pc-windows-msvc`)
- [ ] ARM64 MSI build başarılı (`--target aarch64-pc-windows-msvc`)
- [ ] MSIX Packaging Tool ile her iki architecture wrap'lendi
- [ ] Self-signed cert ile lokal install + run testi yapıldı
- [ ] Migration dialog tetiklendi (legacy `%APPDATA%\D-Terminal` varsa)
- [ ] WACK reportu PASS (banned API yok, manifest temiz)
- [ ] Version 4 segment formatında (`X.Y.Z.0`)
- [ ] Self-signed cert Trusted Root'tan kaldırıldı (cleanup)
- [ ] Partner Center'a x64 + ARM64 MSIX upload edildi
- [ ] Notes for certification dolduruldu (runFullTrust justification)
