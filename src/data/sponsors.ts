// Aktif GitHub Sponsors listesi. Yeni sponsor geldiğinde bu dosyaya ekle —
// AboutModal otomatik render eder. Sponsor iptal ederse buradan çıkar.
//
// Tier sırası: hero > patron > backer > coffee
// (About modal yalnızca isim + tier rozetini gösterir, tutar yazılmaz.)

export type SponsorTier = 'coffee' | 'backer' | 'patron' | 'hero';

export interface Sponsor {
  name: string;
  tier: SponsorTier;
  url?: string;
}

export const SPONSORS: Sponsor[] = [
  // Örnek (sponsor olduğunda yorum kaldır + güncelle):
  // { name: 'jdoe', tier: 'patron', url: 'https://github.com/jdoe' },
];
