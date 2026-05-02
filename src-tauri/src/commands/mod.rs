// Tauri IPC komut handler'ları.
// Frontend `invoke('command_name', args)` ile çağırır.

pub mod ai_proxy;
pub mod dfetch;
pub mod history;
pub mod psreadline;
pub mod pty;
pub mod secrets;
pub mod session;
pub mod settings;
pub mod snippets;
pub mod themes;

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}
