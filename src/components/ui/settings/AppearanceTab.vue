<script setup lang="ts">
// Ayarlar → Görünüm: tema, font, renderer, pencere malzemesi.
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { BUNDLED_FONTS } from '@/fonts';
import DarkSelect, { type DarkSelectOption } from '@/components/ui/DarkSelect.vue';

const { t } = useI18n();
const settings = useSettingsStore();
const themeStore = useThemeStore();

const fontOptions = computed<DarkSelectOption[]>(() =>
  BUNDLED_FONTS.map((f) => ({
    value: f.family,
    label: f.label,
    badge: f.ligatures ? `ligatures · ${f.license}` : f.license,
  })),
);

const rendererOptions = computed<DarkSelectOption[]>(() => [
  { value: 'auto',   label: t('terminal.renderer.auto') },
  { value: 'webgl',  label: t('terminal.renderer.webgl') },
  { value: 'canvas', label: t('terminal.renderer.canvas') },
  { value: 'dom',    label: t('terminal.renderer.dom') },
]);

const vibrancyOptions = computed<DarkSelectOption[]>(() => [
  { value: 'auto',    label: t('settings.appearance.vibrancyAuto') },
  { value: 'mica',    label: t('settings.appearance.vibrancyMica') },
  { value: 'acrylic', label: t('settings.appearance.vibrancyAcrylic') },
  { value: 'none',    label: t('settings.appearance.vibrancyNone') },
]);

async function applyTheme(name: string) {
  settings.state.themeName = name;
  themeStore.setActive(name);
}
</script>

<template>
  <section class="section">
    <div class="field">
      <span>{{ t('settings.appearance.theme') }}</span>
      <small>{{ t('settings.appearance.themeHint') }}</small>
      <div class="theme-grid">
        <button
          v-for="theme in themeStore.themes"
          :key="theme.name"
          type="button"
          class="theme-card"
          :class="{ active: settings.state.themeName === theme.name }"
          :title="theme.description" :aria-label="theme.description"
          :style="{
            background: theme.colors.background,
            color: theme.colors.foreground,
            borderColor: settings.state.themeName === theme.name ? theme.colors.accent : 'transparent',
          }"
          @click="applyTheme(theme.name)"
        >
          <div class="theme-card__head">
            <span class="theme-card__name" :style="{ color: theme.colors.accent }">{{ theme.name }}</span>
            <span v-if="settings.state.themeName === theme.name" class="theme-card__check" :style="{ color: theme.colors.accent }">●</span>
          </div>
          <div class="theme-card__sample">
            <span :style="{ color: theme.colors.red }">$</span>
            <span :style="{ color: theme.colors.green }">git</span>
            <span :style="{ color: theme.colors.yellow }">push</span>
            <span :style="{ color: theme.colors.blue }">origin</span>
            <span :style="{ color: theme.colors.magenta }">main</span>
          </div>
          <div class="theme-card__swatches">
            <span :style="{ background: theme.colors.black }" />
            <span :style="{ background: theme.colors.red }" />
            <span :style="{ background: theme.colors.green }" />
            <span :style="{ background: theme.colors.yellow }" />
            <span :style="{ background: theme.colors.blue }" />
            <span :style="{ background: theme.colors.magenta }" />
            <span :style="{ background: theme.colors.cyan }" />
            <span :style="{ background: theme.colors.white }" />
          </div>
        </button>
      </div>
    </div>
    <label class="field">
      <span>{{ t('settings.appearance.fontFamily') }}</span>
      <DarkSelect v-model="settings.state.fontFamily" :options="fontOptions" />
      <div
        class="font-preview"
        :style="{ fontFamily: settings.state.fontFamily }"
        :aria-label="t('settings.appearance.fontPreview')"
      >const ƒ = (x ⇒ y) → x !== null && x.length > 0;</div>
    </label>
    <label class="field">
      <span>{{ t('settings.appearance.fontSize') }}</span>
      <input v-model.number="settings.state.fontSize" type="number" min="8" max="32" />
    </label>
    <label class="field row">
      <input v-model="settings.state.ligatures" type="checkbox" />
      <span>{{ t('settings.appearance.ligatures') }}</span>
    </label>
    <label class="field">
      <span>{{ t('settings.appearance.opacity') }} — {{ Math.round(settings.state.opacity * 100) }}%</span>
      <input
        v-model.number="settings.state.opacity"
        type="range" min="0.4" max="1" step="0.02"
      />
    </label>
    <label class="field">
      <span>{{ t('settings.appearance.blur') }} — {{ settings.state.blur }}px</span>
      <input
        v-model.number="settings.state.blur"
        type="range" min="0" max="40" step="2"
      />
    </label>
    <label class="field">
      <span>{{ t('settings.appearance.renderer') }}</span>
      <DarkSelect v-model="settings.state.renderer" :options="rendererOptions" />
      <small>{{ t('settings.appearance.rendererHint') }}</small>
    </label>
    <label class="field row">
      <input v-model="settings.state.unicode11" type="checkbox" />
      <span>{{ t('settings.appearance.unicode11') }}</span>
    </label>
    <label class="field row">
      <input v-model="settings.state.screenReaderMode" type="checkbox" />
      <span>{{ t('settings.appearance.screenReaderMode') }}</span>
      <small>{{ t('settings.appearance.screenReaderHint') }}</small>
    </label>
    <label class="field row">
      <input v-model="settings.state.prefixModeEnabled" type="checkbox" />
      <span>{{ t('settings.appearance.prefixMode') }}</span>
      <small>{{ t('settings.appearance.prefixModeHint') }}</small>
    </label>
    <label v-if="settings.state.prefixModeEnabled" class="field">
      <span>{{ t('settings.appearance.prefixCombo') }}</span>
      <input v-model="settings.state.prefixCombo" type="text" placeholder="Ctrl+B" />
    </label>
    <label class="field">
      <span>{{ t('settings.appearance.vibrancy') }}</span>
      <DarkSelect v-model="settings.state.windowVibrancy" :options="vibrancyOptions" />
      <small>{{ t('settings.appearance.vibrancyHint') }}</small>
    </label>
  </section>
</template>

<style scoped src="./settings.css"></style>
