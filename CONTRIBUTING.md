# Katkı Rehberi — D-Terminal

D-Terminal'e ilgilendiğin için teşekkürler! Bu proje **kişisel bir Windows terminal projesidir** ve katkı kapsamı bilinçli olarak dar tutulmuştur.

## Kabul Edilen Katkılar

| Tür | Detay |
|---|---|
| 🐛 Bug report | GitHub Issues — `[BUG]` template'i |
| 💡 Feature request | GitHub Issues — `[FEATURE]` template'i (sadece **fikir**, kod PR'ı değil) |
| 🌍 Dil paketi | `src/locales/<kod>.json` çevirisi → PR |
| 🎨 Tema | `themes/D-<isim>.json` → PR ([rehber](./themes/COMMUNITY.md)) |

## Kabul Edilmeyen Katkılar (Şu An)

| Tür | Sebep |
|---|---|
| 🤖 AI provider adapter | Çekirdek alana çok yakın, ben yöneteceğim |
| 🏗️ Mimari değişiklik | ADR ve mimari karar tek elden ilerliyor |
| ✨ Yeni özellik (kod) | Issue açıp önerin yeter — değerlendirip kendim implementlerim |
| ♻️ Refactor / temizlik | Çekirdek bakımım benim sorumluluğumda |

> **Neden bu kadar dar?** D-Terminal pre-alpha aşamasında (v0.9.x serisi); mimari hızla şekilleniyor. Çekirdek üzerinde dış katkı şu an benim için bakım yükü oluşturuyor — bunun yerine **dil ve tema** topluluk katkısına çok uygun: yan etkisi yok, kullanıcıya doğrudan değer.

---

## 🌍 Dil Paketi Eklemek

`src/locales/` altında **31'den fazla boş stub** dil dosyası hazır bekliyor (`de.json`, `es.json`, `fr.json`, `ja.json`, `zh-CN.json`, `ar.json`, `ru.json`, …). Her stub sadece `_meta` header'ı içerir; çevrilmemiş anahtarlar otomatik olarak **Türkçeye düşer** (`fallbackLocale: 'tr'`).

### Adımlar

1. Repo'yu **fork** et.
2. `feat/i18n-<dil>` branch'i aç (örn. `feat/i18n-de`).
3. `src/locales/<kod>.json` dosyasını **yan tarafta** aç (boş stub).
4. Referans için `src/locales/en.json` (kaynak, İngilizce) veya `src/locales/tr.json` (yazarın dili, en zengin) dosyalarından birini açık tut.
5. Çevirmek istediğin bölümü referanstan **kopyala**, stub'a yapıştır, **sağ taraftaki STRING değerleri** kendi dilinize çevir. **Sol taraftaki anahtarlara DOKUNMA**.
6. `{parametre}` ve `{'{{0}}'}` şablonlarını **aynen bırak** — bunlar runtime'da değişkenle değiştiriliyor.
7. Tamamlanan oranı `_meta.completion` alanında güncelle (örn. `"60%"`). **%80'in altında PR kabul edilmiyor.**
8. `_meta.translator` alanına adını/handle'ını yaz — krediye eklenir.
9. `pnpm tauri dev` ile aç, **Settings → Genel → Dil** menüsünden seç ve test et. Çevirmediğin anahtarlar Türkçe görünmeli (eğer İngilizce görünüyorsa key veya placeholder'da hata var demektir).
10. PR aç. Başlık: `i18n: <Dil Adı> tercümesi (X%)`.

### İpuçları

- Hepsini bir oturumda çevirmek zorunda değilsin — kısmi katkı (≥ %80) da kabul.
- Belirsiz teknik terimler (PTY, sidecar, vb.) İngilizce kalabilir.
- **Stub'a İngilizce metin kopyalama** — eksik anahtar Türkçeye düşmesi için key'i hiç yazmamak daha doğru. Yarım yamalak bir İngilizce kopya, fallback'i devre dışı bırakır.
- Çevrilmiş satırların değeri boş string olmamalı.

### Yeni bir dil yoksa

Stub'lar arasında dilini bulamadıysan: yeni `<ISO-kod>.json` dosyası oluştur, en az `_meta` field'ını doldur, sonra çeviriye başla. (Veya `scripts/seed-locales.ps1`'e dilini ekleyip script'i çalıştır.)

---

## 🎨 Tema Eklemek

Detaylı rehber: [`themes/COMMUNITY.md`](./themes/COMMUNITY.md).

Kısaca:
1. `themes/_template.json` kopyala → `D-<TemaAdı>.json`
2. Renkleri düzenle, `pnpm tauri dev` ile test et
3. PR aç (kontrast, JSON şeması, telif kontrolleri için rehbere bak)

---

## 🐛 Bug Report

[Bug template](./.github/ISSUE_TEMPLATE/bug_report.md)'i doldur. Şunları **mutlaka** ekle:
- D-Terminal sürümü (Hakkında menüsünden)
- Windows sürümü (`winver`)
- Yeniden üretim adımları
- Log dosyası (`%APPDATA%/D-Terminal/logs/` altında)

---

## 💡 Feature Request

[Feature template](./.github/ISSUE_TEMPLATE/feature_request.md)'i doldur. Beğenirsem roadmap'e ekler kendim implementlerim. **Lütfen önce Issue aç, kod yazıp PR atma** — kabul edilmeme ihtimali var, emeğin boşa gitmesin.

---

## Davranış Kuralları

Saygılı, yapıcı ve kapsayıcı bir topluluk hedefliyoruz. [Contributor Covenant](https://www.contributor-covenant.org/) prensiplerine uyulması beklenir.

## İletişim

- GitHub Issues: bug, feature
- GitHub Discussions: sohbet, soru, dil/tema önizleme paylaşımı
- Email (kritik güvenlik açığı): security@d-terminal.dev *(v1.0 ile aktifleşir)*

---

Teşekkürler! 💙 — Orhan Engin OKAY
