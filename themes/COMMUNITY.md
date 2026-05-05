# Tema Katkısı / Theme Contributions

D-Terminal topluluğa **sadece tema, dil paketi ve hata raporu** katkısı için açık.
The community lanes accepted in D-Terminal are **themes, language packs, and bug reports** only.

## Tema eklemek (TR)

1. Repo'yu **fork** et, `feat/theme-<isim>` branch'i aç.
2. Bu klasördeki [`_template.json`](./_template.json) dosyasını kopyala, `D-<TemaAdı>.json` olarak yeniden adlandır.
3. Renkleri düzenle. Beklenen alanlar:
   - `name` (dosya adıyla aynı olmasa da, **Settings → Görünüm**'de bu görünür)
   - `author`, `version`, `description`
   - `colors.*` (16 ANSI rengi + `background`, `foreground`, `accent`, `accent2`, `cursor`, `selection`)
   - `font.*` (kullanıcı tercihi öncelikli, tema sadece varsayılan önerir)
   - `ui.*`, `paneTitle.gradient` (opsiyonel)
4. `pnpm tauri dev` ile aç, **Settings → Görünüm → Tema** menüsünden seç ve test et.
5. Pull Request aç. Başlık: `theme: D-<TemaAdı> ekle`.

## Add a theme (EN)

1. **Fork** the repo and create a `feat/theme-<name>` branch.
2. Copy [`_template.json`](./_template.json) to `D-<ThemeName>.json`.
3. Edit the colors. Required fields:
   - `name` (this is what users see in **Settings → Appearance**)
   - `author`, `version`, `description`
   - `colors.*` (16 ANSI colors + `background`, `foreground`, `accent`, `accent2`, `cursor`, `selection`)
   - `font.*` (user preference wins; theme only suggests a default)
   - `ui.*`, `paneTitle.gradient` (optional)
4. Run `pnpm tauri dev`, switch to your theme via **Settings → Appearance → Theme**, verify it.
5. Open a Pull Request titled `theme: add D-<ThemeName>`.

## Kabul kriterleri / Review criteria

- [ ] Geçerli JSON, tüm zorunlu alanlar dolu / Valid JSON, all required fields present
- [ ] Hex renk formatı (`#RRGGBB` veya `#RRGGBBAA`) / hex color format
- [ ] Foreground / background kontrastı **WCAG AA** (≥ 4.5:1) seviyesinde / WCAG AA contrast
- [ ] 16 ANSI rengi belirgin biçimde ayrı / 16 ANSI colors visually distinct
- [ ] Mevcut bir temanın kopyası değil / not a copy of an existing theme
- [ ] Telif: kendi çalışman veya açık lisanslı bir paletten uyarladığın / your own work or adapted from a freely-licensed palette

## Reddedilen şeyler / What is not accepted

- 🧩 Plugin kodu / plugin code (v2.0+ hedefli, şu an PR kabul edilmiyor)
- 🤖 Yeni AI provider adapter'ı / new AI provider adapters
- 🏗️ Çekirdek mimari / core architecture changes
- ✨ Yeni özellik PR'ları / new feature PRs

Yeni bir özellik fikrin varsa **Issue** aç — değerlendirip kendim geliştirebilirim. Kod PR'ı atılmasını şu an istemiyorum.
If you have a feature idea, open an **Issue** — I will review and may implement it myself. I'm not accepting code PRs for features at this time.
