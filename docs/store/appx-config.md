# D-Terminal — AppX/MSIX Bundle Config Notes

> Tauri 2 ile MS Store paketleme için araştırma notları + scaffold.

---

## 🔍 Tauri 2 — AppX support durumu

### Resmi durum (2026-05 itibarıyla)
- Tauri **CLI** içinde `appx` veya `msix` bundle target **doğrudan yok**
- Tauri 2 docs Microsoft Store dağıtımı için **harici tool** öneriyor:
  - **Microsoft MSIX Packaging Tool** — MSI'yı MSIX'e wrap eder (en yaygın)
  - **Advanced Installer** — ücretli ama professional
  - **WiX Toolset 5** — manuel MSIX manifest yazma

### Sonuç
**MSI → MSIX wrap** yolu en pragmatik:
1. Tauri build → `D-Terminal_0.9.x_x64_tr-TR.msi` (zaten yapıyoruz)
2. MSIX Packaging Tool ile wrap → `D-Terminal_0.9.x.msix`
3. Store'a yükle

---

## 📋 MSIX Packaging Tool — kurulum + kullanım

### 1. Tool'u indir
- Microsoft Store'da "MSIX Packaging Tool" arat → ücretsiz
- Veya: <https://www.microsoft.com/en-us/p/msix-packaging-tool/9n5lw3jbcxkf>

### 2. MSI'dan MSIX üretme
1. Tool'u aç → "Application package" seç
2. Installer source: D-Terminal MSI dosyamızı seç
3. Package information formu:
   - **Package name**: `12345AmrasElessar.DTerminal` (Partner Center'dan)
   - **Package display name**: `D-Terminal`
   - **Publisher name**: `CN=...` (Partner Center'dan)
   - **Publisher display name**: `AmrasElessar` (veya tercih ettiğin isim)
   - **Version**: `0.9.3.0` (4 segment zorunlu — son segment 0)
4. "Prepare computer" → tool monitoring başlatır
5. MSI installer çalışır, tool dosya değişikliklerini yakalar
6. Tamamlandığında "Create" → MSIX dosyası output

### 3. Local test (development cert ile imzala)
```powershell
# Self-signed cert üret (sadece kendi PC'nde test için)
$cert = New-SelfSignedCertificate -Type Custom -Subject "CN=AmrasElessar" `
  -KeyUsage DigitalSignature -FriendlyName "D-Terminal Dev" `
  -CertStoreLocation "Cert:\CurrentUser\My"

# MSIX'i imzala
SignTool sign /fd SHA256 /a /f cert.pfx /p <password> D-Terminal.msix

# Cert'i Trusted Root'a ekle (test için)
Import-Certificate -FilePath cert.cer -CertStoreLocation Cert:\LocalMachine\Root

# MSIX'i kur
Add-AppxPackage -Path D-Terminal.msix
```

> Store submission'da imzalama gerekli **DEĞİL** — Microsoft kendi cert'iyle imzalar.

---

## 🔧 `tauri.conf.json` — minimal değişiklikler

MSIX wrap yolu için `tauri.conf.json`'da büyük değişiklik gerekmiyor. Sadece:

### `bundle.windows.wix.fragmentPaths` — opsiyonel

MSI'ya WiX fragment ekleyerek MSIX wrapper'ın daha iyi kapsama almasını sağlayabiliriz:

```jsonc
"bundle": {
  "windows": {
    "wix": {
      "language": ["en-US", "tr-TR"],
      // MSIX-friendly: registry yazma, AppData yolu sandbox-aware
      "fragmentPaths": ["wix-fragments/msix-bridge.wxs"]
    }
  }
}
```

(Şu an bu **opsiyonel** — MSI çalışıyor.)

### Identity hazırlığı (Partner Center'dan değer gelince)

```jsonc
"bundle": {
  "publisher": "AmrasElessar",
  // identifier: Partner Center reservation'dan sonra DEĞİŞTİRİLECEK
  // "identifier": "12345AmrasElessar.DTerminal"  ← şimdilik yorum
}
```

---

## 📦 Alternatif: Tauri community MSIX plugin (deneysel)

Topluluk plugin'i: <https://github.com/tauri-apps/plugins-workspace> — bazı `appx`/`msix` PR'ları açık ama henüz stable değil.

Risk: PR merge'lenirse Tauri 2 sonrası major sürümle gelir, breaking değişiklik içerebilir. Şimdilik MSIX Packaging Tool **stable + Microsoft-supported** yol.

---

## ✅ AppX-ready check listesi

Submission öncesi:

- [ ] Partner Center hesabı açıldı, $19 ödendi
- [ ] App identity reserve edildi → Name + Publisher CN + Display Name not alındı
- [ ] Privacy policy public URL'de host edildi (GH Pages)
- [ ] Microsoft MSIX Packaging Tool kuruldu
- [ ] D-Terminal MSI build edildi (CI'da)
- [ ] MSI → MSIX wrap edildi
- [ ] MSIX local test edildi (self-signed cert ile install + run)
- [ ] Migration wizard kodu yazıldı (legacy v0.9.x → Store sandbox)
- [ ] 6 screenshot hazırlandı (1920×1080 PNG)
- [ ] Demo video hazırlandı (zaten var: `docs/media/d-terminal-showcase.mp4`)
- [ ] Description metni TR + EN final (zaten hazır: `docs/store/listing.md`)
- [ ] Age rating IARC questionnaire dolduruldu (3+ Everyone)
- [ ] Notes for certification metni hazırlandı
- [ ] Submit → Microsoft review (~1-3 iş günü)
