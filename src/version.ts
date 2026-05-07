// Tek versiyon kaynağı — frontend'in her yerinden import edilir.
//
// Kaynak: package.json'ın "version" alanı (Vite JSON import desteği ile build
// time'da static olarak yüklenir; runtime overhead yok). Değiştirmek için
// SADECE package.json + src-tauri/Cargo.toml + src-tauri/tauri.conf.json
// güncelleyin → buradan otomatik yansır.
//
// shellInit/powershell.ps1 ve cmd-prompt.txt'deki sürüm string'leri ayrı
// kaynaklar (Tauri bundle'a raw asset olarak gömülür); onlar release script
// veya manuel sync gerekir. Önemsiz: sürüm bumb sırasında 5 dosya değişir.

import pkg from '../package.json';

export const APP_VERSION: string = (pkg as { version: string }).version;
export const APP_NAME = 'D-Terminal';
