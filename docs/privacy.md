---
layout: page
title: Privacy Policy
permalink: /privacy.html
---

# D-Terminal — Privacy Policy / Gizlilik Politikası

> **Last updated / Son güncelleme:** 2026-05-27
> **Applies to / Geçerli sürüm:** D-Terminal v0.10.0 ve üzeri / and later (v0.9.6+ ile büyük oranda aynı / largely identical)
>
> 🌐 **TR · EN** — Bu sayfa iki dillidir / This page is bilingual

[🏠 Ana sayfa / Home](./) · [📂 GitHub](https://github.com/AmrasElessar/d-terminal)

**Kısa özet / TL;DR:**
- ❌ Telemetri yok / No telemetry
- ❌ Analitik yok / No analytics
- ❌ Sunucumuza veri gitmez / No data sent to our servers
- ✅ Tüm veriler **senin bilgisayarında** kalır / All data stays **on your machine**
- ✅ AI API key'leri **Windows DPAPI** ile şifrelenir / AI API keys encrypted via Windows DPAPI

---

## 🇹🇷 Türkçe

### 1. Kim olduğumuz

D-Terminal, **Orhan Engin OKAY** (D Brand) tarafından geliştirilen, GPL-3.0-or-later lisanslı ve açık kaynaklı bir Windows terminal uygulamasıdır (v0.10.0 öncesi sürümler MIT). İletişim: `orhanenginokay@gmail.com`

### 2. Hangi verileri topluyoruz?

**Hiçbir veriyi merkezi sunucularımıza göndermiyoruz.** D-Terminal'de telemetri, analitik, çökme raporlama veya kullanım istatistikleri yoktur.

#### 2.1 Yerel olarak saklanan veriler

Aşağıdaki veriler **yalnızca senin bilgisayarında** SQLite veritabanında (`%APPDATA%\D-Terminal\dterminal.db`) saklanır, **hiçbir yere gönderilmez**:

- Komut geçmişi (`command_history`) — çalıştırdığın shell komutları, çıkış kodları
- Snippet'ler (`snippets`) — kayıtlı kısayol komutlar
- Oturum/layout durumu (`sessions`) — pane düzeni, açık tab'lar
- Ayarlar (`settings`) — tema seçimi, klavye kısayolları, profil tercihleri

Bu veritabanını istediğin zaman silebilirsin (uygulamayı kapat → dosyayı sil).

#### 2.2 Şifreli credential storage (Windows DPAPI)

AI provider API key'lerin (Anthropic, OpenAI, Gemini, vb.) **Windows Data Protection API (DPAPI)** ile şifrelenir; sadece senin Windows kullanıcı hesabınla çözülebilir. Frontend'e (UI'a) **plain key sızmaz**.

### 3. Ağ iletişimi

D-Terminal aşağıdaki durumlarda internet'e bağlanır:

#### 3.1 AI istekleri (sen başlatırsın)

AI özelliklerini kullandığında (`Ctrl+Shift+G` komut üretici, AI Chat, Block→AI), seçtiğin sağlayıcının API'sine **doğrudan** istek atılır:
- **Anthropic** — `api.anthropic.com`
- **OpenAI** — `api.openai.com`
- **Google Gemini** — `generativelanguage.googleapis.com`
- **Ollama / yerel runtime'lar** — `localhost` (asla dışarı çıkmaz)
- **Özel endpoint** — senin yapılandırdığın URL

Mesajların ve konuşma geçmişin **bizim sunucularımızdan geçmez**, doğrudan Rust HTTP proxy'den seçtiğin sağlayıcıya gider. Her sağlayıcının kendi gizlilik politikası geçerlidir:
- Anthropic: <https://www.anthropic.com/legal/privacy>
- OpenAI: <https://openai.com/policies/privacy-policy/>
- Google: <https://policies.google.com/privacy>

#### 3.2 Otomatik güncelleme kontrolü

Uygulama açılışında **GitHub'a** (`api.github.com/repos/AmrasElessar/d-terminal/releases/latest`) yeni sürüm var mı sorgusu yapılır. Bu istek sadece **sürüm metadata'sı** içerir, kullanıcı tanımlayıcı veri yoktur.

### 4. DFetch — sistem bilgisi

DFetch özelliği sistemden CPU, RAM, disk, ekran, locale, IP gibi bilgileri **yerel olarak** okur. **KVKK/GDPR maskeleme** varsayılan olarak aktiftir: hostname ve IP gizli, 👁 ikonuyla aç/kapa.

Bu bilgi **hiçbir yere gönderilmez** — sadece sen görürsün, isteğe bağlı olarak panele kopyalarsın.

### 4.1 Process Isolation (v0.9.6+)

D-Terminal Windows Job Object ile spawn ettiği tüm child process'leri (sidecar, `git_stat`'ın `git` çağrıları) izole eder:

- **Console suppression** — child process console pencereleri gizlenir (DOS flash'ları kullanıcı görüş alanından çıkar)
- **Otomatik temizlik** — D-Terminal abrupt kapanırsa (taskkill, kernel panic, OS shutdown) tüm child process'ler `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ile kernel tarafından otomatik terminate edilir; orphan process kalmaz
- **Toggle**: Settings → Gizlilik & Performans → "Suppress child console windows"

Bu mekanizma gizliliğe katkı sağlar: istemli olmayan console pencerelerinin stdout/stderr akışı (örn. yanlışlıkla görünen credential prompt'ları) sınırlandırılır.

### 5. Çocukların gizliliği

D-Terminal **13+ yaş** için tasarlanmıştır. 13 yaş altı kullanıcılardan bilinçli olarak veri toplamayız.

### 6. Veri silme hakkı

Tüm veriler yerel olduğu için silmek için:
1. Uygulamayı kapat
2. `%APPDATA%\D-Terminal\` klasörünü sil
3. (İsteğe bağlı) DPAPI vault'taki credential'ları temizle: Ayarlar → AI Sağlayıcılar → her birinin yanındaki "Sil"

### 7. Bu politikadaki değişiklikler

Önemli değişikliklerde GitHub release notes'unda duyurulur. Uygulama içinde değişiklik bildirimi yok (telemetri olmadığı için).

---

## 🇬🇧 English

### 1. Who we are

D-Terminal is a GPL-3.0-or-later licensed, open-source Windows terminal application developed by **Orhan Engin OKAY** (D Brand) (versions before v0.10.0 were released under MIT). Contact: `orhanenginokay@gmail.com`

### 2. What data do we collect?

**We do not send any data to our central servers.** D-Terminal contains no telemetry, analytics, crash reporting, or usage statistics.

#### 2.1 Locally stored data

The following data is stored **only on your computer** in a SQLite database (`%APPDATA%\D-Terminal\dterminal.db`) and **never transmitted**:

- Command history (`command_history`) — shell commands you've run, exit codes
- Snippets (`snippets`) — saved shortcut commands
- Session/layout state (`sessions`) — pane layout, open tabs
- Settings (`settings`) — theme, keyboard shortcuts, profile preferences

You can delete this database any time (close app → delete file).

#### 2.2 Encrypted credential storage (Windows DPAPI)

Your AI provider API keys (Anthropic, OpenAI, Gemini, etc.) are encrypted with the **Windows Data Protection API (DPAPI)** — only your Windows user account can decrypt them. **Plaintext keys never leak to the frontend (UI).**

### 3. Network communication

D-Terminal connects to the internet only in the following cases:

#### 3.1 AI requests (you initiate)

When you use AI features (`Ctrl+Shift+G` command generator, AI Chat, Block→AI), the request goes **directly** to the provider you've configured:
- **Anthropic** — `api.anthropic.com`
- **OpenAI** — `api.openai.com`
- **Google Gemini** — `generativelanguage.googleapis.com`
- **Ollama / local runtimes** — `localhost` (never leaves your machine)
- **Custom endpoint** — the URL you configure

Your messages and conversation history **do not pass through our servers** — they go directly from the Rust HTTP proxy to your chosen provider. Each provider's privacy policy applies:
- Anthropic: <https://www.anthropic.com/legal/privacy>
- OpenAI: <https://openai.com/policies/privacy-policy/>
- Google: <https://policies.google.com/privacy>

#### 3.2 Automatic update check

On app startup, a query is made to **GitHub** (`api.github.com/repos/AmrasElessar/d-terminal/releases/latest`) to check for new versions. This request contains **only version metadata** — no user-identifying data.

### 4. DFetch — system info

The DFetch feature reads CPU, RAM, disk, display, locale, IP and similar information **locally**. **GDPR/KVKK masking** is enabled by default: hostname and IP are hidden; toggle with the 👁 icon.

This information **is never transmitted** — only you see it; you may optionally copy it to a pane.

### 5. Children's privacy

D-Terminal is designed for users **13 and older**. We do not knowingly collect data from users under 13.

### 6. Right to deletion

All data is local. To delete:
1. Close the app
2. Delete `%APPDATA%\D-Terminal\` folder
3. (Optional) Clear credentials in DPAPI vault: Settings → AI Providers → click "Delete" next to each

### 7. Changes to this policy

Material changes are announced in GitHub release notes. No in-app change notifications (since we don't have telemetry to push them).

---

## 📜 License of this document

This privacy policy itself is licensed under [CC0 1.0 (public domain)](https://creativecommons.org/publicdomain/zero/1.0/) — feel free to adapt it for your own open-source projects.
