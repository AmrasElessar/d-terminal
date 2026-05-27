// İnsan-okunabilir byte formatı — B/KB/MB/GB cutoff'larında otomatik geçer.
// Örnek: 1024 → "1 KB", 1536 → "1.5 KB", 12_345_678 → "11.8 MB".
// Migration dialog'da, ileride dfetch/log boyutlarında da yeniden kullanılır.

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  let value = n;
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  // 10'dan büyükse veya B birimindeysek ondalık göstermeyiz — daha okunabilir.
  const decimals = value >= 10 || i === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${UNITS[i]}`;
}
