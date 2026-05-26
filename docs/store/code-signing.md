# D-Terminal — Code Signing Rehberi

> İmzalama D-Terminal için iki ayrı dağıtım kanalında **farklı önem** taşır:
> - **MS Store:** Microsoft kendi cert'iyle MSIX'i imzalar. Submit ettiğin paketin imzalı olması **zorunlu değil**.
> - **GitHub Releases (NSIS + MSI):** İmzasız → Windows SmartScreen "Bilinmeyen yayıncı" uyarısı + ML antivirüsler (Microsoft Defender Wacatac!ml, K7GW, Antiy-AVL) false positive verir. İmzalı → uyarılar kalkar, false positive sayısı düşer.

---

## Sertifika seçenekleri karşılaştırması

| Seçenek | Maliyet | EV-grade | OSS uyumlu | Önerme |
|---|---|---|---|---|
| **SignPath FOSS** | Ücretsiz | Hayır (regular OV) | ✅ FOSS projeleri için | ⭐ Birinci tercih |
| **Azure Trusted Signing** | $9.99/ay (~$120/yıl) | Hayır | ✅ | Hızlı setup, Microsoft Identity Verification |
| **DigiCert EV Code Signing** | $349-499/yıl | ✅ | ✅ | Anında SmartScreen reputation; pahalı |
| **Sectigo / SSL.com** | $179-299/yıl OV / $499 EV | OV veya EV | ✅ | Orta segment, hardware token gerektirir |
| **Self-signed** | Ücretsiz | ❌ | (test only) | Lokal test, prod **YASAK** |

> 💡 **D-Terminal için seçim:** **SignPath FOSS** birinci tercih. Açık kaynak GPL-3.0-or-later projeler için ücretsiz, GitHub Actions entegrasyonu hazır. Başvuru kabul edilirse 1-2 hafta içinde sertifika kullanıma açılır.

---

## 1. SignPath FOSS başvurusu

### Ön koşullar
- Proje GitHub'da **public** olmalı ✅ (D-Terminal public)
- Lisans **OSI-onaylı open source** olmalı ✅ (GPL-3.0-or-later)
- Stable/release artifact'leri olmalı ✅ (v0.10.0 release page)
- Maintainer kişi/kurum tanımlanabilir olmalı ✅ (Orhan Engin OKAY, D Brand)

### Başvuru adımları
1. <https://signpath.org/foundation> → "Apply for the SignPath Foundation"
2. Form alanları (yaklaşık 10 dk):
   - **Project name:** D-Terminal
   - **Project URL:** `https://github.com/AmrasElessar/d-terminal`
   - **License:** GPL-3.0-or-later
   - **Why important:** Kişisel kullanım için modern Windows terminal alternatifi; AI-native, açık kaynak; SmartScreen + ML AV false positive'leri kullanıcı engelliyor
   - **Maintainer info:** Orhan Engin OKAY, `orhanenginokay@gmail.com`
   - **Distribution method:** GitHub Releases (MSI + NSIS) — şu an yıllık ~12 release tahmini
3. SignPath onayı: **1-2 hafta** (gönüllü inceleme süreci)
4. Onaylanırsa: GitHub App entegrasyonu, secret'lar ayarlanır

### CI/CD entegrasyonu (onay sonrası)
`.github/workflows/release.yml` içine yeni step:

```yaml
- name: SignPath sign artifacts
  uses: signpath/github-action-submit-signing-request@v1
  with:
    api-token: '${{ secrets.SIGNPATH_API_TOKEN }}'
    organization-id: '<signpath-org-id>'
    project-slug: 'd-terminal'
    signing-policy-slug: 'release-signing'
    github-artifact-id: '${{ steps.upload-unsigned.outputs.artifact-id }}'
    wait-for-completion: true
    output-artifact-directory: 'signed/'
```

Sonra `Upload artifacts` step'i signed/ dizininden okur — release sayfasına imzalı asset'ler gider.

---

## 2. Azure Trusted Signing (alternatif — hızlı setup)

SignPath onayı uzun sürerse veya FOSS başvurusu reddedilirse:

1. Azure Portal → "Trusted Signing Accounts" → yeni hesap (~$9.99/ay)
2. Microsoft Identity Verification (kişisel veya kurumsal)
3. Trust profile oluştur (`d-terminal-release`)
4. GitHub Actions secret'a Azure credentials ekle
5. release.yml'a:

```yaml
- name: Azure Trusted Signing
  uses: azure/trusted-signing-action@v0.5.0
  with:
    azure-tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    azure-client-id: ${{ secrets.AZURE_CLIENT_ID }}
    azure-client-secret: ${{ secrets.AZURE_CLIENT_SECRET }}
    endpoint: https://eus.codesigning.azure.net/
    trusted-signing-account-name: AmrasElessar-d-terminal
    certificate-profile-name: d-terminal-release
    files-folder: src-tauri/target/release/bundle/
    files-folder-filter: msi,exe
    file-digest: SHA256
    timestamp-rfc3161: http://timestamp.acs.microsoft.com
```

> ⚠️ Azure Trusted Signing **EV-grade değil** — anında SmartScreen reputation kazandırmaz ama imza eksikliğini kapatır.

---

## 3. EV Code Signing (acil ihtiyaç + bütçe varsa)

Anında SmartScreen reputation gerekiyorsa:
- **DigiCert KeyLocker** (~$499/yıl) — bulut-tabanlı, hardware token yok
- **Sectigo EV** (~$499/yıl) — HSM/YubiKey gerekiyor

EV cert sahibi olduğun ilk 5-10 download'da Microsoft SmartScreen otomatik trust verir; OV cert için ~3000 unique download gerekir. v0.x faz için **gereksiz over-engineering** — SignPath FOSS yeterli.

---

## 4. Self-signed test cert (yalnızca local MSIX testi için)

MSIX wrap yapıp Add-AppxPackage ile install edip test etmek için self-signed yeterli. **Hiçbir zaman release artifact'lerine self-signed cert uygulanmaz.**

```powershell
# CN= MSIX manifest publisher'ı ile birebir AYNI olmalı
$cert = New-SelfSignedCertificate `
  -Type Custom `
  -Subject "CN=AmrasElessar Dev" `
  -KeyUsage DigitalSignature `
  -FriendlyName "D-Terminal Dev Cert" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")

# Export to .pfx for SignTool
$password = ConvertTo-SecureString -String "devpassword" -Force -AsPlainText
Export-PfxCertificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
  -FilePath ".\dev-cert.pfx" -Password $password

# Trust the cert (LocalMachine\Root) — sadece kendi PC'nde test için
Export-Certificate -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" -FilePath ".\dev-cert.cer"
Import-Certificate -FilePath ".\dev-cert.cer" -CertStoreLocation Cert:\LocalMachine\Root

# MSIX'i imzala
& "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.0.26100.0\x64\SignTool.exe" `
  sign /fd SHA256 /a /f .\dev-cert.pfx /p devpassword .\D-Terminal_0.10.0.msix
```

> 🧹 Test bittiğinde cert'i sil: `Remove-Item Cert:\CurrentUser\My\$thumbprint`

---

## 5. Beklenen VirusTotal etkisi (imza sonrası)

İmzalı v0.10.0 release artifact'lerinde tahmini değişim (önceki v0.9.x baseline'ından çıkarım):

| Artifact | İmzasız (v0.10.0 mevcut) | SignPath OV sonrası (tahmini) |
|---|---|---|
| ARM64 MSI TR | `0/60 clean` | `0/60 clean` (zaten temiz) |
| x64 MSI TR | `~2-3/60` (Antiy-AVL + K7GW + Rising) | `~0-1/60` (ML tetikleyicilerin çoğu imza ile düşer) |
| NSIS setup | `~1-4/71` (Microsoft Wacatac.B!ml + Sophos PUA + K7GW) | `~0-1/71` (Microsoft ML imza ile öğrenir, FP düşer) |

Microsoft Defender SmartScreen "Bilinmeyen yayıncı" uyarısı tamamen kalkar (OV cert ile birkaç indirme sonrası reputation oluşur, EV cert ile anında).

---

## 6. Karar matrisi

```
SignPath FOSS başvuru sonucu bekleniyor mu?
├── Kabul → CI'a entegre et, release'leri imzala (sonsuza dek ücretsiz)
├── Reddedilirse → Azure Trusted Signing veya bütçe ayır
└── Bekleniyor → Geçici çözüm: VirusTotal scan + sayfa açıklamalarıyla kullanıcıları bilgilendir
```

Mevcut README'de zaten "SignPath FOSS pending" badge var (`[![Code Signing]...]`); badge label "approved" olunca trigger yeşil.

---

## 7. Referanslar

- SignPath Foundation: <https://signpath.org/foundation>
- Azure Trusted Signing: <https://learn.microsoft.com/en-us/azure/trusted-signing/>
- Microsoft SmartScreen reputation: <https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/>
- VirusTotal API (CI submission): `release.yml` `Submit to VirusTotal + Hybrid Analysis` step zaten v0.9.x'ten beri çalışıyor
