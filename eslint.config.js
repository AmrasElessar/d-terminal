// ESLint v9 flat config — Vue 3 + TypeScript.
//
// Minimal MVP ayar — strict tip kontrolü `vue-tsc` üzerinde, ESLint sadece
// genel kod kalitesi ve Vue convention'ları kontrol eder.

import js from '@eslint/js';
import vuePlugin from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'sidecar/**',
      'coverage/**',
      '*.config.js',
      '*.config.ts',
    ],
  },
  js.configs.recommended,
  ...vuePlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx,vue}'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // TypeScript zaten kullanılmayan değişkenleri yakalıyor; lint ek kural eklemiyor
      'no-unused-vars': 'off',
      'no-undef': 'off', // TS halleder
      'vue/multi-word-component-names': 'off',
      // XSS riski — v-html kullanılan her yer manuel review gerektirir.
      // 'warn' yerine 'error': prod build CI'sinde hatayla durur, kontrolsüz
      // v-html eklenmesini önler. Mevcut kullanım yoksa break-the-build maliyeti yok.
      'vue/no-v-html': 'error',
      'vue/require-default-prop': 'off',
      'vue/attributes-order': 'warn',
      'vue/html-self-closing': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
    },
  },
];
