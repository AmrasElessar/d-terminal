// Tracing setup + log path manager.
//
// Strateji: stderr (renkli, dev için) + dosya (daily rotate, ANSI yok)
// — `tracing-subscriber::registry` ile multi-layer.

use std::path::{Path, PathBuf};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct LogPaths {
    pub dir: PathBuf,
}

impl LogPaths {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// tracing-appender günlük dosyayı UTC tarihiyle adlandırır; yerel tarih
    /// kullanılırsa UTC+3'te 00:00-03:00 arası var olmayan dosyayı gösterir.
    pub fn current_file(&self) -> PathBuf {
        let date = chrono::Utc::now().format("%Y-%m-%d");
        self.dir.join(format!("{LOG_PREFIX}.{date}"))
    }
}

const LOG_PREFIX: &str = "dterminal.log";
/// Disk'te tutulan en fazla günlük log dosyası (eskiler otomatik silinir).
const MAX_LOG_FILES: usize = 14;

pub fn init_tracing(log_dir: &Path) -> WorkerGuard {
    let _ = std::fs::create_dir_all(log_dir);

    // Builder: günlük rotasyon + son MAX_LOG_FILES dosyayı tut (eskiden log'lar
    // hiç budanmıyordu). Builder hata verirse (dizin yazılamaz) yalnızca
    // stderr'a log'la — uygulama açılışını log dosyası yüzünden düşürme.
    let file_appender = tracing_appender::rolling::RollingFileAppender::builder()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix(LOG_PREFIX)
        .max_log_files(MAX_LOG_FILES)
        .build(log_dir);
    let writer: Box<dyn std::io::Write + Send> = match file_appender {
        Ok(a) => Box::new(a),
        Err(e) => {
            eprintln!("log file appender init failed: {e}");
            Box::new(std::io::sink())
        }
    };
    let (non_blocking, guard) = tracing_appender::non_blocking(writer);

    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("d_terminal_lib=info,sidecar=info,info"));

    let stderr_layer = fmt::layer().with_writer(std::io::stderr).with_ansi(true);
    let file_layer = fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false);

    tracing_subscriber::registry()
        .with(env_filter)
        .with(stderr_layer)
        .with(file_layer)
        .init();

    guard
}
