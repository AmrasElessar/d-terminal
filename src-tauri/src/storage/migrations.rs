// Refinery migration runner.
//
// `migrations/V*__*.sql` dosyaları derleme sırasında embed edilir.

refinery::embed_migrations!("./migrations");

pub fn run(conn: &mut rusqlite::Connection) -> crate::error::AppResult<()> {
    migrations::runner().run(conn)?;
    Ok(())
}
