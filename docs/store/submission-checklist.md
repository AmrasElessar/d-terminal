# D-Terminal — Microsoft Store Submission Checklist

> Tek noktadan submission durumu. Her madde tamamlandıkça `[ ]` → `[x]`.
> Hedef: **v1.0** (3-4 ay) — v0.10.0 sonrası release marathon'unda.
>
> 13 task'lık MS Store hazırlık planının özetidir. Detaylar için her bölümün
> sonundaki linklere bak.

**Son güncelleme:** 2026-05-26 — v0.10.0 sonrası prep başladı

---

## ✅ Hazır olan içerikler (kod + dokümanlar)

| # | Madde | Dosya / Referans |
|---|---|---|
| ✅ | Listing metinleri (TR + EN, 10K char altı) | [docs/store/listing.md](./listing.md) |
| ✅ | Identity migration stratejisi (B önerildi) | [docs/store/identity-migration.md](./identity-migration.md) |
| ✅ | MSIX wrap mimari notları | [docs/store/appx-config.md](./appx-config.md) |
| ✅ | MSIX wrap detaylı step-by-step | [docs/store/msix-build-guide.md](./msix-build-guide.md) |
| ✅ | Code signing rehberi | [docs/store/code-signing.md](./code-signing.md) |
| ✅ | Privacy policy (KVKK/GDPR, GPL-3.0+ güncel) | [docs/privacy.md](../privacy.md) |
| ✅ | Privacy policy public URL aktif | https://amraselessar.github.io/d-terminal/privacy.html |
| ✅ | Demo video | `docs/media/d-terminal-showcase.mp4` |
| ✅ | MSI artifact'leri her release'de | v0.10.0 release (6 dosya: x64 + ARM64 × MSI-TR/EN/NSIS) |
| ✅ | Migration wizard (Rust) | `src-tauri/src/storage/migrate_legacy.rs` |
| ✅ | Migration wizard (Vue UI) | `src/components/ui/MigrationDialog.vue` |
| ✅ | tauri.conf.json MSIX hazırlığı | publisher placeholder + WiX fragment |

---

## 👤 Kullanıcı eylemleri (BLOCKING — Partner Center)

| # | Madde | Tahmini süre | Durum |
|---|---|---|---|
| 1 | Partner Center hesabı aç (https://partner.microsoft.com/dashboard/registration) | 30 dk | ⏳ Bekleniyor |
| 2 | $19 tek seferlik developer ödemesi | 5 dk | ⏳ Bekleniyor |
| 3 | "Apps and games → Reserve a new app name" → "D-Terminal" reserve | 15 dk | ⏳ Bekleniyor |
| 4 | Publisher CN + Package Identity Name + Display Name not al | 5 dk | ⏳ Bekleniyor |
| 5 | 6 ekran görüntüsü hazırla (1920×1080 PNG) | 1-2 saat | ⏳ Bekleniyor |
| 6 | SignPath FOSS başvurusu (https://signpath.org/foundation) | 15 dk + 1-2 hafta onay | ⏳ Opsiyonel |
| 7 | IARC age rating questionnaire (submit anında doldurulur) | 10 dk | ⏳ Submit'te |

**6 screenshot çekim listesi** ([docs/store/listing.md](./listing.md) line 172):
1. Hero shot: Boş D-Terminal, mavi gradient, welcome banner
2. AI command generator: `#` ile doğal dilden komut üretimi popup
3. Multi-pane workspace: 4 pane (PS + CMD + WSL + AI Chat)
4. Agent Watch: Claude Code çalışırken canlı maliyet rozeti
5. DFetch overlay: sistem bilgisi, ANSI swatch, neofetch logo
6. Theme picker: Settings'te 14 tema kart-grid

Çekilen dosyaları `docs/store/screenshots/{01-hero,02-ai,...}.png` olarak koy.

---

## 🔧 Kod + config (Partner Center bilgisi gelince finalize)

| # | Madde | Status |
|---|---|---|
| ✅ | Migration wizard Rust kodu | Done (Task#6) |
| ✅ | Migration wizard Vue UI + i18n | Done (Task#7) |
| ✅ | tauri.conf.json placeholder | Done (Task#5) — publisher CN comment ile |
| 🔧 | tauri.conf.json publisher CN'i Partner Center'dan gelen değerle güncelle | Task#5 follow-up (sonra) |
| ✅ | listing.md placeholder URL'leri ve sertifika notu finalize | Done (Task#10) |

---

## 📦 Build + test (Partner Center sonrası)

| # | Madde | Detay |
|---|---|---|
| 🔧 | MSIX Packaging Tool kurulumu (`winget install Microsoft.MsixPackagingTool`) | docs/store/msix-build-guide.md adım 1 |
| 🔧 | v0.10.x veya v1.0 MSI build (CI tetikli, otomatik) | release.yml her tag'de üretir |
| 🔧 | MSI → MSIX wrap (manuel veya scripts/wrap-msix.ps1) | docs/store/msix-build-guide.md adım 2-4 |
| 🔧 | Self-signed cert üret + MSIX'i imzala (local test) | docs/store/code-signing.md §4 |
| 🔧 | `Add-AppxPackage` ile install + run testi | First launch'ta migration wizard çalışmalı |
| 🔧 | DPAPI secret decrypt testi (Store sandbox path'inde) | Migration wizard'ın critical path'i |
| 🔧 | Uninstall + reinstall cycle test | AppX clean uninstall davranışı |
| 🔧 | Microsoft Defender + SmartScreen lokal davranış | Self-signed → "Bilinmeyen yayıncı", normal |

---

## 🚀 Submission (Partner Center'da)

| # | Madde | Detay |
|---|---|---|
| 🚀 | Partner Center → Apps and games → D-Terminal → Submission #1 → Start submission | Submission flow |
| 🚀 | Pricing and availability: Free, all markets | Şu an monetization yok |
| 🚀 | Properties: Developer tools / Development kits, 3+ Everyone | listing.md'den kopyala |
| 🚀 | Age ratings (IARC questionnaire): 10 dk anketi doldur | Auto-generated |
| 🚀 | Packages: D-Terminal_X.Y.Z.msix upload | x64 + ARM64 her ikisi |
| 🚀 | Store listings: Description, screenshots, features, keywords | listing.md TR + EN |
| 🚀 | Notes for certification: runFullTrust gerekçesi + node-pty açıklaması | listing.md'de hazır |
| 🚀 | Privacy URL: https://amraselessar.github.io/d-terminal/privacy.html | ✅ Aktif |
| 🚀 | Submit → Microsoft review | 1-3 iş günü |

---

## 📣 Post-submission

| # | Madde | Detay |
|---|---|---|
| 📣 | Onaylanırsa: Store badge'i README'ye ekle ("Available on Microsoft Store") | Task#13 |
| 📣 | GitHub Releases v0.x.y release notes'a "MS Store'da yayınlandık" banner | identity-migration.md adım 3 |
| 📣 | Migration wizard'ın legacy install detect ettiğini canlı kullanıcılarla doğrula | Telemetri yok, kullanıcı feedback'i |
| 📣 | Social media duyurusu (Twitter/X, LinkedIn, Reddit r/windowsterminal) | Opsiyonel |
| 📣 | Microsoft Store reviewer geri bildirimleri varsa adresle | Submission #2'ye not düş |

---

## 📊 Mevcut tahmini timeline

```
T+0      v0.10.0 release ✅ (2026-05-26)
T+0      MS Store prep kod/dokuman ✅ (kullanıcı eylemleri hariç hazır)
T+?      Kullanıcı: Partner Center hesabı + $19 + identity reservation
T+?+1d   Screenshot çekim + listing finalize
T+?+1d   MSIX wrap + local test
T+?+2d   Submission
T+?+5d   Microsoft review tamamlanır (1-3 iş günü)
T+?+1w   Store'da yayında 🎉
```

**Aktif blocker:** Partner Center hesabı + identity reservation (Task #1-2).

Kullanıcı `T+?` = "diğer ay" (post-2026-05) demiş. Diğer her şey hazır; kullanıcı eyleminden sonra MSIX wrap + submission birkaç saatlik iş.

---

## Bilinmesi gerekenler

- **Code signing zorunlu değil** — MS Store kendi cert'iyle MSIX wrap eder. SignPath FOSS ayrı kanal (GitHub NSIS dağıtımı için).
- **Migration v0.9.x → MSIX otomatik upgrade YOK** — Windows iki sürümü farklı uygulama görür (farklı identity). Migration wizard ile veri taşınır (kullanıcı opt-in).
- **AppData sandbox** — MSIX sandbox'ında `%LOCALAPPDATA%\Packages\<id>\LocalState\`'a yazar. Migration wizard bu path'i otomatik tespit eder.
- **Auto-updater** — Store sürümü Microsoft updater kullanır (latest.json/minisign yok). GitHub sürümü mevcut updater'la devam eder.
- **Telemetri yok** — privacy.md ve listing.md'de net belirtilmiş. Microsoft reviewer'a "no telemetry" notu eklendi.

---

## Çapraz referanslar

- [listing.md](./listing.md) — Store form metinleri (TR + EN)
- [identity-migration.md](./identity-migration.md) — Legacy→Store strateji
- [appx-config.md](./appx-config.md) — MSIX teknik notları
- [msix-build-guide.md](./msix-build-guide.md) — Step-by-step MSIX wrap
- [code-signing.md](./code-signing.md) — SignPath/Azure/EV karşılaştırması
- [../privacy.md](../privacy.md) — Privacy policy (GH Pages: /privacy.html)
- `src-tauri/src/storage/migrate_legacy.rs` — Migration utility
- `src/components/ui/MigrationDialog.vue` — Migration UI
