# D-Terminal · Repo Standards

> **Hedef konum:** `C:\Projeler\dterminal\REPO_STANDARDS.md` (lokal klasör adı `dterminal`, remote `d-terminal`)
> Reponun köküne kopyalayıp commit'leyin. Sonraki düzenlemeler bu dosyaya bağlı kalmalı — değişiklik gerekirse burayı da güncelleyin (drift önleme).
>
> **Snapshot:** 2026-05-14 (D Brand README + about/topics align sonrası)
> **Bu repo, D Brand README iskeletinin kanonik kaynağıdır** — diğer 7 D Brand repo buna align'lanmıştır.

---

## 1. Locked GitHub metadata

| Alan | Değer |
|---|---|
| **Owner/Repo** | `AmrasElessar/d-terminal` |
| **Visibility** | public |
| **Default branch** | `main` |
| **License (SPDX)** | `GPL-3.0` (or-later — README'de açıkça belirtilir) |
| **Description** | `Agent-aware Windows terminal — multi-shell, AI-native, specialized panes in one window. Tauri v2 + Vue 3 + Rust.` |
| **Homepage** | `https://github.com/AmrasElessar/d-terminal/releases` |
| **Topics (20)** | `agent, agent-aware, ai, anthropic, arm64, claude-code, cmd, developer-tools, ollama, open-source, openai, powershell, rust, tauri, tauri-v2, terminal, vue, windows, wsl, xterm` |

Değişiklik yaparsanız bu tabloyu güncelleyin + `gh repo edit` / `gh api PUT topics` ile remote'a yansıtın.

---

## 2. README iskeleti (D Brand template)

D-Terminal'in README yapısı bu marka ailesinin **kanonik şablonudur**. Diğer repolar buna align'lanmıştır.

### 2.1 Bölüm sırası (kanonik)

1. **Header** — center-aligned div: logo (opsiyonel) + başlık + İngilizce tagline + TR/EN alt-tagline + bilingual notice
2. **🎬 Demo** — video / screenshot / "coming soon" placeholder
3. **Badge row** — CI · Release · Downloads → License → Status → Platform → Tech stack → D Brand
4. **🛡 Güvenlik / Security badges** (varsa: VT, code signing, DPAPI, CSP)
5. **📌 Kısaca** (TR) + collapsible `🇬🇧 At a glance` (EN)
6. **🆕 Yenilikler / What's done so far** — son sürümdeki büyük başlıklar (bullet list)
7. **🎯 Vizyon / Vision** (opsiyonel)
8. **✨ Öne Çıkan Özellikler / Key Features** — alt başlıklarla gruplanmış (`### 🤖 AI`, `### 🪟 Pane`...)
9. **🛠️ Teknoloji / Tech Stack** — bullet liste + mimari döküman linkleri
10. **🗺️ Yol Haritası / Roadmap** — tablo veya checklist
11. **📥 Kurulum / Installation** + **🚀 İlk Adımlar / Quick Start** (release varsa)
12. **🛡️ Güvenlik Tarama / Security Scan Results** (release varsa — VT, signing, dependency audit)
13. **🤝 Katkı / Contributing**
14. **🎨 D Brand Ailesi / D Brand Family** — diğer 7 D Brand repo linki
15. **💖 Sponsorlar / Sponsors**
16. **❤️ Destekle / Support** — Star, Sponsor, Store coming soon
17. **📜 Lisans / License**

Pre-alpha / status'a göre 11-12 düşürülebilir; **sıralama bozulmaz**.

### 2.2 Header pattern

```markdown
<div align="center">

<img src="<icon-path>" width="128" alt="<Repo> logo" />

# <Repo Name>

**<Bir cümlelik İngilizce tagline>**

*<TR alt-tagline>*
*<EN alt-tagline>*

🌐 **TR · EN** — Bu README iki dillidir / This README is bilingual (English collapsibles below each section)

</div>
```

### 2.3 Badge row sırası ve renk

```
[CI] [Release] [Downloads]                       (varsa)
[License: GPL-3.0+] (mavi)  veya  [Proprietary] (kırmızı)
[Status: pre-alpha/alpha/MVP/stable]             (turuncu→yeşil)
[Platform: Windows / Android / Linux]            (Windows mavi #1E88E5, Android yeşil #3DDC84)
[Tech: Tauri v2 / Vue 3 / Rust / Kotlin / ...]   (2-4 badge)
[D Brand]                                        (yeşil #00FF66 ya da mor #8A2BE2 premium)
```

### 2.4 Bilingual yapı

- Ana akış **Türkçe**
- Uzun paragraflar için `<details><summary>🇬🇧 <section> (English)</summary> ... </details>`
- Kısa bullet'lar tek satırda "TR · EN" olarak yazılabilir

---

## 3. Tech stack & status

- **Status:** pre-alpha (v0.9.x serisi)
- **Core:** Tauri v2 (Rust core + WebView2)
- **Frontend:** Vue 3
- **Language(s):** Rust (backend), TypeScript/Vue (frontend)
- **Target:** Windows 10 1809+ ve Windows 11
- **Architecture:** dual-arch (x64 + ARM64)
- **Distribution:** GitHub Releases (MSI, NSIS); Microsoft Store coming soon
- **Special:** OSC 9999 AI Agent Watch protokolü, DPAPI secret storage, strict CSP

---

## 4. Lisans

- **GPL-3.0-or-later** (SPDX: `GPL-3.0`). README'de "GPL-3.0-or-later" formuyla belirtilir.
- `LICENSE` dosyası repo köğünde; standart GPL-3.0 text'i.
- Yeni dosyalar GPL header taşımak zorunda değil ama license dosyası referans olarak kalır.

---

## 5. Commit mesaj stili

Conventional commits. Recent log'dan gözlemlenen prefix'ler:

- `feat(readme): ...` — README'ye yeni bölüm/feature
- `fix(readme): ...` — README'de hata/typo düzeltme
- `docs(readme): ...` — README içerik align/restructure
- `chore: ...` — config (FUNDING.yml, LICENSE değişimi, dependency bump)
- `feat(<area>): ...`, `fix(<area>): ...` — kod tarafı (pane, agent, ui, ...)

Dil: **TR veya EN**, aynı PR içinde tutarlı olunmalı. "Why" 1 cümleyle özetlensin; detay `git diff`'te.

---

## 6. Dosya hijyeni

- Adı `:` veya `\` içeren dosyalar **commit'lenmez** — yol parse hatası kalıntısı (örn. `C:Tempd-terminal-readme.md`). Temizlik: `git clean -n` → görür, `git clean -f` → siler.
- **Zorunlu** repo köğünde:
  - `README.md`
  - `LICENSE` — §4'teki lisans ile **birebir** eşleşmeli
  - `.github/FUNDING.yml` (public — Sponsors badge için)
- **Tercih edilen:**
  - `.gitignore` — IDE klasörleri (`.idea/`, `.vscode/`), build artifacts, log
  - `docs/` — uzun teknik dökümanlar (README şişmesin)
- **Push öncesi `git status`** — sürpriz dosya kalmasın (`_scratch/`, `*.log`, `*.docx` draft'lar).

---

## 7. Repo-spesifik notlar

- **Kanonik şablon kaynağı** — bu reponun README yapısı diğer D Brand repolarının baz aldığı şablondur. Burada yapılan strüktürel değişiklik **diğer 7 repoya da yansıtılmalı**.
- **VirusTotal tracking** — her release sonrası VT taraması yapılıp README'deki security badge'leri güncellenir (false-positive sayıları + commit hash linkli).
- **Dual-arch artifact discipline** — ARM64 MSI + x64 MSI + NSIS, hepsi her release'de.
- **Microsoft Store badge'i** — "coming soon" linkli kalır (`docs/store/listing.md`'ye), yayınlanınca güncellenir.
- **Agent Watch protokol versiyonu** (OSC 9999) — README'de versiyon belirtildi; protokol bump = major version bump tetikler.
