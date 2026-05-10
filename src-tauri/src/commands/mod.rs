// Tauri IPC komut handler'ları.
// Frontend `invoke('command_name', args)` ile çağırır.

pub mod admin;
pub mod ai;
pub mod ai_proxy;
pub mod config_io;
pub mod dfetch;
pub mod git_stat;
pub mod history;
pub mod logger;
pub mod logstream;
pub mod process;
pub mod psreadline;
pub mod pty;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod snippets;
pub mod themes;
pub mod window;

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
