// Refinery migration runner.
//
// `migrations/V*__*.sql` dosyaları derleme sırasında embed edilir.
//
// `set_abort_divergent(false)`: refinery 0.8.x'te embed_migrations! macro'sunun
// hesapladığı checksum, derleme ortamına bağlı olarak (whitespace/encoding
// nuance) tutarsız olabilir. v0.1.1 ile v0.9.2 arasında V001 dosyası git'te
// hiç değişmediği halde kullanıcıların DB'sinde kayıtlı checksum mismatch
// çıkıyordu. Strict mode panic atıp app'i çökertiyordu. Tolerant mode warning
// log'lar, app çalışmaya devam eder. Migration disiplini değişmedi: V001
// dokunulmaz, yeni şema değişiklikleri V002+ olarak eklenir.

refinery::embed_migrations!("./migrations");

pub fn run(conn: &mut rusqlite::Connection) -> crate::error::AppResult<()> {
    migrations::runner().set_abort_divergent(false).run(conn)?;
    Ok(())
}
