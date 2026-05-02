#!/usr/bin/env bash
# CI'da çalışan tüm kontrolleri yerel makinede çalıştırır.
# Push'tan önce: bash scripts/check-all.sh

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

bold()  { printf "\033[1m▶ %s\033[0m\n" "$1"; }
green() { printf "\033[32m✓ %s\033[0m\n" "$1"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; }

bold "Frontend: TypeScript"
pnpm exec vue-tsc --noEmit
green "TypeScript clean"

bold "Frontend: ESLint"
pnpm lint
green "Lint clean"

bold "Frontend: Vite build"
pnpm build > /dev/null
green "Build clean"

bold "Sidecar: tests"
( cd sidecar && npm test )
green "Sidecar tests clean"

if command -v cargo > /dev/null; then
  bold "Rust: format check"
  ( cd src-tauri && cargo fmt --check )
  green "rustfmt clean"

  bold "Rust: clippy"
  ( cd src-tauri && cargo clippy -- -D warnings )
  green "Clippy clean"

  bold "Rust: tests"
  ( cd src-tauri && cargo test )
  green "Rust tests clean"
else
  printf "\033[33m⚠  cargo bulunamadı, Rust kontrolleri atlandı (rustup ile kurun)\033[0m\n"
fi

green "Hepsi geçti — push güvenli"
