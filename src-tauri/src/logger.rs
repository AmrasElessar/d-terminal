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

    pub fn current_file(&self) -> PathBuf {
        let date = chrono::Local::now().format("%Y-%m-%d");
        self.dir.join(format!("dterminal.log.{date}"))
    }
}

pub fn init_tracing(log_dir: &Path) -> WorkerGuard {
    let _ = std::fs::create_dir_all(log_dir);

    let file_appender = tracing_appender::rolling::daily(log_dir, "dterminal.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

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
