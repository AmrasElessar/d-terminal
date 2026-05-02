// D-Terminal — Tauri main entrypoint
//
// Windows release build'inde konsol penceresi açılmaz.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    d_terminal_lib::run();
}
