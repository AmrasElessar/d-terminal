# Topluluk cevirisi icin BOS stub locale dosyalari olustur (sadece _meta header).
# vue-i18n eksik key'leri fallback dile (tr) dusurur, bu yuzden stub'lar bos olmali.
# Cevirmenler en.json'i (kaynak) veya tr.json'i (referans) acip key'leri kopyalayarak doldurur.
# Var olan dosyalara dokunmaz.
# Calistir:  powershell -NoProfile -File scripts/seed-locales.ps1

param(
  [string]$RepoRoot = (Resolve-Path "$PSScriptRoot/..").Path,
  [switch]$Force  # Var olan stub'lari bile yeniden yaz (tehlikeli — ceviri varsa kaybolur)
)

$ErrorActionPreference = 'Stop'
$localesDir = Join-Path $RepoRoot 'src/locales'

$languages = @(
  @{ code='de';    name='German';                native='Deutsch' },
  @{ code='es';    name='Spanish';               native='Espanol' },
  @{ code='fr';    name='French';                native='Francais' },
  @{ code='it';    name='Italian';               native='Italiano' },
  @{ code='pt-BR'; name='Portuguese (Brazil)';   native='Portugues (Brasil)' },
  @{ code='pt-PT'; name='Portuguese (Portugal)'; native='Portugues (Portugal)' },
  @{ code='ru';    name='Russian';               native='Russkiy' },
  @{ code='uk';    name='Ukrainian';             native='Ukrainska' },
  @{ code='pl';    name='Polish';                native='Polski' },
  @{ code='cs';    name='Czech';                 native='Cestina' },
  @{ code='nl';    name='Dutch';                 native='Nederlands' },
  @{ code='sv';    name='Swedish';               native='Svenska' },
  @{ code='no';    name='Norwegian';             native='Norsk' },
  @{ code='da';    name='Danish';                native='Dansk' },
  @{ code='fi';    name='Finnish';               native='Suomi' },
  @{ code='hu';    name='Hungarian';             native='Magyar' },
  @{ code='ro';    name='Romanian';              native='Romana' },
  @{ code='bg';    name='Bulgarian';             native='Bulgarski' },
  @{ code='el';    name='Greek';                 native='Ellinika' },
  @{ code='he';    name='Hebrew';                native='Ivrit' },
  @{ code='ar';    name='Arabic';                native='Arabiyya' },
  @{ code='fa';    name='Persian';               native='Farsi' },
  @{ code='hi';    name='Hindi';                 native='Hindi' },
  @{ code='id';    name='Indonesian';            native='Bahasa Indonesia' },
  @{ code='vi';    name='Vietnamese';            native='Tieng Viet' },
  @{ code='th';    name='Thai';                  native='Phasa Thai' },
  @{ code='ja';    name='Japanese';              native='Nihongo' },
  @{ code='ko';    name='Korean';                native='Hangugeo' },
  @{ code='zh-CN'; name='Chinese (Simplified)';  native='Zhongwen (Jianti)' },
  @{ code='zh-TW'; name='Chinese (Traditional)'; native='Zhongwen (Fanti)' },
  @{ code='az';    name='Azerbaijani';           native='Azerbaycan dili' }
)

$instructionsTr = "Bu dosya bos bir stub. Cevirmek icin: en.json (kaynak) veya tr.json (referans) dosyalarini acin, kopyaladiginiz key'leri buraya ekleyin ve sag tarafi kendi dilinize cevirin. Eksik key'ler otomatik olarak Turkceye dusecektir. {parametre} ve {'{{0}}'} sablonlarina dokunmayin."
$instructionsEn = "This file is an empty stub. To translate: open en.json (source) or tr.json (reference), copy the keys here, and translate the right-hand strings into your language. Missing keys automatically fall back to Turkish. Keep {placeholders} and {'{{0}}'} templates intact."

$created = 0
$skipped = 0

foreach ($lang in $languages) {
  $code = $lang.code
  $outPath = Join-Path $localesDir "$code.json"
  if ((Test-Path $outPath) -and (-not $Force)) {
    Write-Host "atlandi (var):  $code.json"
    $skipped++
    continue
  }

  $stub = @"
{
  "_meta": {
    "language": "$($lang.name)",
    "nativeName": "$($lang.native)",
    "code": "$code",
    "translator": "TODO",
    "completion": "0%",
    "instructions_tr": "$instructionsTr",
    "instructions_en": "$instructionsEn"
  }
}
"@

  [System.IO.File]::WriteAllText($outPath, $stub, [System.Text.UTF8Encoding]::new($false))
  if ($Force) {
    Write-Host "yeniden yazildi: $code.json"
  } else {
    Write-Host "olusturuldu:     $code.json"
  }
  $created++
}

Write-Host ""
Write-Host "Bitti: $created stub yazildi, $skipped mevcut dosya korundu."
