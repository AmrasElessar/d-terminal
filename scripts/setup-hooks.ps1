# D-Terminal git hook'larini aktif et.
# Bir kerelik calistirin: pwsh scripts/setup-hooks.ps1
#
# core.hooksPath ile .githooks/ dizinini hook source yapariz; husky/lint-staged
# gibi npm dependency eklemeden temiz pre-commit. CI ayrica tam check yapar
# (cargo fmt+clippy+test, vue-tsc, lint, vitest).

$ErrorActionPreference = 'Stop'

if (-not (Test-Path .git)) {
    Write-Error 'Repo kokunde calistirin (git klasoru bulunamadi).'
}

git config core.hooksPath .githooks

# Pre-commit script'i Windows'ta da execute edilebilir olsun
# (git for windows shebang'i yorumlar, ama dosya izni gerekirse fix).
if (Test-Path .githooks/pre-commit) {
    Write-Host '✓ core.hooksPath = .githooks' -ForegroundColor Green
    Write-Host '✓ pre-commit hook aktif (cargo fmt check + eslint stage)' -ForegroundColor Green
} else {
    Write-Warning '.githooks/pre-commit bulunamadi'
}

Write-Host ''
Write-Host 'Hook devre disi birakmak icin: git config --unset core.hooksPath' -ForegroundColor Cyan
