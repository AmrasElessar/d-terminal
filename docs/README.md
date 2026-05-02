# D-Terminal Belgeleri

Bu klasör D-Terminal projesinin teknik belgelerini içerir.

## Yapı

```
docs/
├── README.md                          # Bu dosya
├── architecture-v1.1-changes.md       # v1.0 → v1.1 değişiklik özeti
└── adr/                               # Architecture Decision Records
    ├── template.md                    # Yeni ADR şablonu
    ├── 0001-pty-sidecar-ipc-protocol.md
    ├── 0002-secret-storage-dpapi.md
    ├── 0003-storage-rusqlite-only.md
    └── 0004-plugin-worker-sandbox.md
```

## ADR Nedir?

Architecture Decision Record — projedeki kritik mimari kararların gerekçesini, kabul edilen tradeoff'ları ve değerlendirilen alternatifleri belgeleyen kısa metinler. Tek sayfa, versiyonlanmış, immutable (değişmez — yeni karar yeni ADR'dir).

Yeni ADR ekleme:
1. `adr/template.md` kopyala, sıradaki numarayla isimlendir (`adr/00NN-kebab-case-baslik.md`)
2. Status: `Proposed` ile başla, kabul edildiğinde `Accepted` yap
3. Eski karar değişirse: yeni ADR yaz, eski ADR'ye `Status: Superseded by ADR-NNNN` ekle — silme

## Versiyon Politikası

- `D-Terminal-Mimari-v1.0.docx`: Orijinal mimari vizyon belgesi (proje kök dizininde)
- `architecture-v1.1-changes.md`: v1.0'a uygulanacak düzeltmeler (bu klasörde)
- ADR'lar: Tek tek mimari kararlar, v1.1+ sürümünde belge metnine entegre edilecek
