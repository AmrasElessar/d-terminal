<script setup lang="ts">
// MigrationDialog — Store sürümü ilk açılışta legacy install algılarsa
// kullanıcıya "verilerini aktarayım mı?" diye sorar.
//
// State machine:
//   idle      → kullanıcı henüz karar vermedi
//   running   → migrate çalışıyor (kullanıcı butonlara basamaz)
//   success   → tamamlandı, kullanıcı yeniden başlatma önerisi alır
//   failure   → hata mesajı + tekrar dene seçeneği
//
// Tauri komutları: api.migrateRun / api.migrateDismiss.
// Detect & wiring AppShell.vue içinde, bu komponent sadece UI durumunu yönetir.

import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { DetectedLegacy, MigrationReport } from '@/api/tauri';
import { formatBytes } from '@/utils/formatBytes';
import { createLogger } from '@/utils/logger';
import { useFocusTrap } from '@/composables/useFocusTrap';

const log = createLogger('migration-dialog');

const props = defineProps<{
  open: boolean;
  detected: DetectedLegacy;
}>();

const emit = defineEmits<{
  close: [];
  migrated: [report: MigrationReport];
  dismissed: [];
}>();

const { t } = useI18n();

type Phase = 'idle' | 'running' | 'success' | 'failure';
const phase = ref<Phase>('idle');
const report = ref<MigrationReport | null>(null);
const errorMessage = ref<string>('');

const dbSizeFormatted = computed(() => formatBytes(props.detected.db_size_bytes));
const reportSizeFormatted = computed(() =>
  report.value ? formatBytes(report.value.total_bytes) : '0 B',
);
const isRunning = computed(() => phase.value === 'running');

async function runMigration() {
  phase.value = 'running';
  errorMessage.value = '';
  try {
    const result = await api.migrateRun();
    report.value = result;
    phase.value = 'success';
    emit('migrated', result);
  } catch (err: unknown) {
    // Tauri AppError serialize formatı: { kind, message }
    const detail =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
    errorMessage.value = detail;
    phase.value = 'failure';
  }
}

async function dismissMigration() {
  try {
    await api.migrateDismiss();
  } catch (err: unknown) {
    // Dismiss başarısız olsa bile UI'dan kapanmasını engellemiyoruz —
    // marker yazılmadıysa bir sonraki açılışta tekrar sorulur, kullanıcı
    // yeniden seçer. Structured log → user'ın log file'ına da girer.
    log.warn('migrate_dismiss failed', { error: String(err) });
  }
  emit('dismissed');
  emit('close');
}

function closeDialog() {
  // success/failure'dan sonra kullanıcı modal'ı manuel kapatır.
  // idle aşamasında kapat = "şimdilik vazgeç" — marker yazılmaz, tekrar sorulur.
  emit('close');
}

function retry() {
  void runMigration();
}

// Focus trap + restoration — `<dialog open>` programatik açıldığı için
// browser native modal trap devreye girmiyor. WCAG 2.1.2 + 2.4.3.
const panel = ref<HTMLElement | null>(null);
const dismissBtn = ref<HTMLButtonElement | null>(null);
const openRef = toRef(props, 'open');
useFocusTrap({
  panel,
  open: openRef,
  initialFocus: dismissBtn as unknown as typeof panel,
});

// ESC handler — yalnız modal açıkken aktif. running fazında ESC yutuluyor
// (kullanıcı migration ortasında modal'ı kapatamasın, race oluşturmasın).
function onKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (phase.value === 'running') return;
  e.preventDefault();
  closeDialog();
}
watch(openRef, (isOpen) => {
  if (isOpen) window.addEventListener('keydown', onKeydown, true);
  else window.removeEventListener('keydown', onKeydown, true);
});

// Phase transition announce — screen reader idle→success/failure geçişini
// kaçırmasın. aria-live="assertive" + role="status" kombosu.
const phaseAnnouncement = computed(() => {
  switch (phase.value) {
    case 'success': return t('migration.successTitle');
    case 'failure': return t('migration.failureTitle');
    case 'running': return t('migration.progress');
    default:        return '';
  }
});
</script>

<template>
  <dialog v-if="props.open" class="dialog" open @click.self="closeDialog">
    <article
      ref="panel"
      class="dialog__panel"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="mig-title"
      aria-describedby="mig-desc"
    >
      <!-- Phase transition announcer — DOM'da daima var ki SR
           idle→success/failure geçişini kaçırmasın (a11y M3). -->
      <span class="sr-only" role="status" aria-live="assertive" aria-atomic="true">
        {{ phaseAnnouncement }}
      </span>

      <!-- idle / running: detect bilgisi + butonlar -->
      <template v-if="phase === 'idle' || phase === 'running'">
        <h2 id="mig-title">{{ t('migration.title') }}</h2>
        <p id="mig-desc" class="subtitle">{{ t('migration.subtitle') }}</p>

        <ul class="details">
          <li>{{ t('migration.detectedFrom', { path: detected.path }) }}</li>
          <li>{{ t('migration.dbSize', { size: dbSizeFormatted }) }}</li>
          <li v-if="detected.has_themes">{{ t('migration.hasThemes') }}</li>
          <li v-if="detected.has_config">{{ t('migration.hasConfig') }}</li>
        </ul>

        <p class="privacy"><span aria-hidden="true">🔒 </span>{{ t('migration.privacy') }}</p>

        <!-- Progress region DAİMA mount'lu (v-show), aria-live polite ile.
             v-if olsaydı DOM'a geç eklenince NVDA/JAWS içeriği duyurmayabilir
             (a11y M2). aria-atomic="true" → her güncelleme tek seferde okunur. -->
        <div v-show="isRunning" class="progress" aria-live="polite" aria-atomic="true">
          <span class="progress__spinner" aria-hidden="true" />
          <span>{{ t('migration.progress') }}</span>
        </div>

        <div class="actions">
          <button
            ref="dismissBtn"
            type="button"
            class="ghost"
            :disabled="isRunning"
            @click="dismissMigration"
          >
            {{ t('migration.dismiss') }}
          </button>
          <button
            type="button"
            class="primary"
            :disabled="isRunning"
            @click="runMigration"
          >
            {{ t('migration.migrate') }}
          </button>
        </div>
      </template>

      <!-- success: tamamlandı ekranı -->
      <template v-else-if="phase === 'success'">
        <h2 id="mig-title"><span aria-hidden="true">✅ </span>{{ t('migration.successTitle') }}</h2>
        <p id="mig-desc" class="subtitle">
          {{ t('migration.successBody', { bytes: reportSizeFormatted }) }}
        </p>
        <p class="hint">{{ t('migration.successHint') }}</p>
        <div class="actions">
          <button type="button" class="primary" @click="closeDialog">
            {{ t('migration.close') }}
          </button>
        </div>
      </template>

      <!-- failure: hata + tekrar dene -->
      <template v-else>
        <h2 id="mig-title"><span aria-hidden="true">⚠ </span>{{ t('migration.failureTitle') }}</h2>
        <p id="mig-desc" class="subtitle">{{ t('migration.failureBody', { error: errorMessage }) }}</p>
        <div class="actions">
          <button type="button" class="ghost" @click="closeDialog">
            {{ t('migration.close') }}
          </button>
          <button type="button" class="primary" @click="retry">
            {{ t('migration.failureRetry') }}
          </button>
        </div>
      </template>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: var(--color-overlay-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 110;
}
.dialog__panel {
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  border-radius: var(--ui-radius, 8px);
  padding: 20px;
  min-width: 460px;
  max-width: 600px;
  color: var(--color-fg);
}
/* Görsel olarak gizli ama SR'a açık — phase transition announcer için.
   WCAG-Audit-Conformance pattern (sadece görsel kullanıcıdan saklar). */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
h2 {
  margin: 0 0 6px 0;
  font-size: 16px;
}
.subtitle {
  margin: 0 0 12px 0;
  font-size: 12px;
  opacity: 0.85;
}
.details {
  list-style: none;
  padding: 0;
  margin: 0 0 12px 0;
  font-size: 11px;
  display: grid;
  gap: 4px;
}
.details li {
  padding: 6px 10px;
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  border-left: 2px solid var(--color-accent);
  border-radius: 2px;
  word-break: break-all;
}
.privacy {
  margin: 0 0 12px 0;
  font-size: 11px;
  color: var(--color-dim);
}
.hint {
  margin: 0 0 12px 0;
  font-size: 11px;
  color: var(--color-dim);
  font-style: italic;
}
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-accent);
  margin-bottom: 12px;
}
.progress__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--color-accent) 30%, transparent);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.actions button {
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
  font-size: 11px;
}
.actions button:disabled { opacity: 0.4; cursor: not-allowed; }
.ghost {
  background: transparent;
  color: var(--color-fg);
  /* WCAG 1.4.11 (Non-text Contrast): UI komponent kenarlığı min 3:1. */
  border-color: color-mix(in srgb, var(--color-fg) 28%, transparent);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  font-weight: 600;
}
/* prefers-reduced-motion: app-global zaten 0.01ms transition uyguluyor;
   spin keyframe duration de orada otomatik kısaltılır. */
</style>
