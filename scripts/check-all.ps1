# CI'da çalışan tüm kontrolleri yerel makinede çalıştırır (PowerShell).
# Push'tan önce: pwsh scripts/check-all.ps1

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Step($msg) { Write-Host "▶ $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }

Step 'Frontend: TypeScript'
pnpm exec vue-tsc --noEmit
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Ok 'TypeScript clean'

Step 'Frontend: ESLint'
pnpm lint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Ok 'Lint clean'

Step 'Frontend: Vite build'
pnpm build | Out-Null
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Ok 'Build clean'

Step 'Sidecar: tests'
Push-Location sidecar
npm test
$sidecarRc = $LASTEXITCODE
Pop-Location
if ($sidecarRc -ne 0) { exit $sidecarRc }
Ok 'Sidecar tests clean'

if (Get-Command cargo -ErrorAction SilentlyContinue) {
  Step 'Rust: format check'
  Push-Location src-tauri
  cargo fmt --check
  $fmtRc = $LASTEXITCODE
  Pop-Location
  if ($fmtRc -ne 0) { exit $fmtRc }
  Ok 'rustfmt clean'

  Step 'Rust: clippy'
  Push-Location src-tauri
  cargo clippy -- -D warnings
  $clippyRc = $LASTEXITCODE
  Pop-Location
  if ($clippyRc -ne 0) { exit $clippyRc }
  Ok 'Clippy clean'

  Step 'Rust: tests'
  Push-Location src-tauri
  cargo test
  $testRc = $LASTEXITCODE
  Pop-Location
  if ($testRc -ne 0) { exit $testRc }
  Ok 'Rust tests clean'
} else {
  Write-Host '⚠  cargo bulunamadı, Rust kontrolleri atlandı (rustup ile kurun)' -ForegroundColor Yellow
}

Ok 'Hepsi geçti — push güvenli'
