<script setup lang="ts">
// Klasik "Matrix code rain" arka plan efekti — D-Matrix temasında WelcomePane
// üzerinde overlay olarak çalışır. Canvas tabanlı: her sütun bağımsız bir
// "düşen glyph zinciri", trail effect rgba alpha fill ile.
//
// `intensity` 0..1: 1.0 = tam yağmur (intro), <0.3 = arka plan atmosferi.
// `prefers-reduced-motion` kontrolü — kullanıcı azaltılmış hareket istemişse
// canvas hiç başlatılmaz, sade siyah render kalır.

import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 0..1 yoğunluk; intro'da 1.0, fade-out sonrası 0.15-0.25 atmosfer. */
    intensity?: number;
    /** Düşme hızı multiplier; 1.0 default. */
    speed?: number;
  }>(),
  { intensity: 1.0, speed: 1.0 },
);

const canvas = ref<HTMLCanvasElement>();
let rafId = 0;
let columnsY: number[] = [];
let resizeObs: ResizeObserver | undefined;

const GLYPHS =
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ' +
  '0123456789' +
  ':・="*+-<>¦|=*+';
const FONT_SIZE = 16;
const LEAD_FADE = 0.075; // her frame trail clear alpha — büyük = daha kısa iz

function randGlyph(): string {
  return GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
}

function setup() {
  if (!canvas.value) return;
  const c = canvas.value;
  // prefers-reduced-motion saygısı — animasyon yok.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Yüksek DPI cihazlarda crisp render.
  const dpr = window.devicePixelRatio || 1;
  const ctx = c.getContext('2d');
  if (!ctx) return;

  function resize() {
    if (!canvas.value) return;
    const w = canvas.value.clientWidth;
    const h = canvas.value.clientHeight;
    canvas.value.width = w * dpr;
    canvas.value.height = h * dpr;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.max(1, Math.floor(w / FONT_SIZE));
    // Sütunları rastgele başlangıçla doldur — açılışta uniform gradient değil.
    columnsY = new Array(cols)
      .fill(0)
      .map(() => -Math.random() * (h / FONT_SIZE) * 2);
  }
  resize();
  resizeObs = new ResizeObserver(resize);
  resizeObs.observe(c);

  function draw() {
    if (!canvas.value || !ctx) return;
    const w = canvas.value.clientWidth;
    const h = canvas.value.clientHeight;
    const intensity = Math.max(0, Math.min(1, props.intensity));

    // Trail fade — siyah alpha ile her frame'de canvas'ı hafif silikleştir;
    // önceki glyph'ler dim olur, oluşan iz "yağmur akışı" hissi verir.
    ctx.fillStyle = `rgba(0, 8, 0, ${LEAD_FADE + (1 - intensity) * 0.06})`;
    ctx.fillRect(0, 0, w, h);

    ctx.font = `${FONT_SIZE}px "Cascadia Code", "Consolas", monospace`;
    ctx.textBaseline = 'top';

    for (let i = 0; i < columnsY.length; i++) {
      const x = i * FONT_SIZE;
      const y = columnsY[i]! * FONT_SIZE;
      // Lider karakter parlak yeşilimsi-beyaz, hemen altındaki klasik yeşil.
      // Bu klasik Matrix opening krediler estetiği.
      if (y >= 0 && y < h) {
        ctx.fillStyle = `rgba(180, 255, 200, ${0.85 * intensity})`;
        ctx.fillText(randGlyph(), x, y);
        // Bir önceki konum (trail başı) yumuşak yeşil
        if (y - FONT_SIZE >= 0) {
          ctx.fillStyle = `rgba(0, 240, 80, ${0.75 * intensity})`;
          ctx.fillText(randGlyph(), x, y - FONT_SIZE);
        }
      }
      // Alta ulaşıp yeniden tepeden başlatma — rastgele aralıklarla.
      if (y > h && Math.random() > 0.985) {
        columnsY[i] = -Math.random() * 10;
      }
      columnsY[i]! += props.speed;
    }
    rafId = requestAnimationFrame(draw);
  }
  rafId = requestAnimationFrame(draw);
}

function teardown() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  resizeObs?.disconnect();
  resizeObs = undefined;
}

onMounted(setup);
onBeforeUnmount(teardown);

// Intensity 0'a düşse bile canvas çalışmaya devam eder (fade out animasyonu
// için). Tema değişimi gibi durumlarda v-if ile component unmount edilirse
// teardown otomatik temizler.
watch(
  () => props.intensity,
  () => {
    /* no-op — draw loop her frame intensity'yi yeniden okur */
  },
);
</script>

<template>
  <canvas ref="canvas" class="matrix-rain" aria-hidden="true" />
</template>

<style scoped>
.matrix-rain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  /* Welcome pane'in arka planında ama logo/satırların altında.
     opacity için CSS transition — JS intensity ramp ile birlikte yumuşak. */
  z-index: 0;
  display: block;
}
</style>
