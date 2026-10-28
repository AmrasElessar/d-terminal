// Güvenli paste/insert yardımcıları.
//
// Bracketed paste mode açıksa (PSReadLine 2.x, bash/zsh readline) metin
// `ESC[200~ ... ESC[201~` ile sarılır; shell hiçbir satırı Enter olarak
// yorumlamaz. Kapalıysa (cmd.exe, eski shell'ler) her `\r` komutu çalıştırır —
// bu durumda çağıran ya onay almalı ya da satır sonlarını kaldırmalıdır.

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export function lineCountOf(text: string): number {
  return (text.match(/\r\n|\r|\n/g)?.length ?? 0) + 1;
}

/** Pano metnini PTY'ye yazılacak hale getirir. Metnin içindeki paste-bitiş
 *  dizisi temizlenir — aksi halde yapıştırılan içerik bracketed paste'ten
 *  "kaçıp" kalan satırları çalıştırabilirdi. */
export function preparePaste(text: string, bracketed: boolean): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/\x1b\[20[01]~/g, '');
  const normalized = cleaned.replace(/\r\n|\n/g, '\r');
  return bracketed ? `${PASTE_START}${normalized}${PASTE_END}` : normalized;
}

/** "Ekle, çalıştırma" — bracketed paste yoksa satır sonlarını boşlukla değiştir
 *  ki hiçbir satır otomatik çalışmasın. Sondaki satır sonları atılır. */
export function prepareInsert(text: string, bracketed: boolean): string {
  const trimmed = text.replace(/[\r\n]+$/, '');
  if (bracketed) return preparePaste(trimmed, true);
  // eslint-disable-next-line no-control-regex
  return trimmed.replace(/\x1b\[20[01]~/g, '').replace(/\r\n|\r|\n/g, ' ');
}
