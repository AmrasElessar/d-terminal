// Sidecar IPC modülü.
//
// Bkz. ADR-0001 (docs/adr/0001-pty-sidecar-ipc-protocol.md).
//
// `protocol` — frame encode/decode (binary length-prefixed)
// `manager`  — sidecar process spawn, multiplexing, heartbeat

pub mod manager;
pub mod protocol;

pub use manager::{PtyEvent, SidecarManager};
