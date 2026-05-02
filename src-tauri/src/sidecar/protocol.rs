// PTY sidecar wire protokolü.
//
// Frame layout (bkz. ADR-0001):
//
//   ┌─────────────┬──────────┬───────────────┬─────────────┐
//   │ length (4)  │ type (1) │ pane_id (8)   │ payload (N) │
//   └─────────────┴──────────┴───────────────┴─────────────┘
//
//   length:  payload uzunluğu (big-endian u32, max 16 MB)
//   type:    mesaj tipi (u8)
//   pane_id: pane tanımlayıcısı (big-endian u64; 0 = control/heartbeat)
//   payload: type'a göre raw bytes veya CBOR-kodlu yapı

use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use serde::{Deserialize, Serialize};
use std::io::{self, Cursor, Read, Write};
use thiserror::Error;

/// Maks payload boyutu (DoS koruması).
pub const MAX_PAYLOAD: usize = 16 * 1024 * 1024;

/// Frame header sabit boyutu: 4 (len) + 1 (type) + 8 (pane_id).
pub const HEADER_LEN: usize = 13;

/// Mesaj tipleri. `repr(u8)` — wire üzerindeki sayısal değerler ABI sözleşmesidir.
#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MsgType {
    Spawn = 0x01,
    Stdin = 0x02,
    Stdout = 0x03,
    Resize = 0x04,
    Kill = 0x05,
    Exit = 0x06,
    Ping = 0x07,
    Pong = 0x08,
    Error = 0x09,
    FlowResume = 0x0A,
}

impl MsgType {
    pub fn from_byte(b: u8) -> Result<Self, ProtocolError> {
        match b {
            0x01 => Ok(Self::Spawn),
            0x02 => Ok(Self::Stdin),
            0x03 => Ok(Self::Stdout),
            0x04 => Ok(Self::Resize),
            0x05 => Ok(Self::Kill),
            0x06 => Ok(Self::Exit),
            0x07 => Ok(Self::Ping),
            0x08 => Ok(Self::Pong),
            0x09 => Ok(Self::Error),
            0x0A => Ok(Self::FlowResume),
            other => Err(ProtocolError::UnknownMsgType(other)),
        }
    }
}

#[derive(Debug, Error)]
pub enum ProtocolError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error("payload too large: {0} bytes (max {})", MAX_PAYLOAD)]
    PayloadTooLarge(u32),
    #[error("unknown message type: 0x{0:02X}")]
    UnknownMsgType(u8),
    #[error("cbor decode error: {0}")]
    CborDecode(String),
    #[error("cbor encode error: {0}")]
    CborEncode(String),
}

/// Tek bir wire frame'i.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub msg_type: MsgType,
    pub pane_id: u64,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(msg_type: MsgType, pane_id: u64, payload: impl Into<Vec<u8>>) -> Self {
        Self {
            msg_type,
            pane_id,
            payload: payload.into(),
        }
    }

    /// Control mesajları için kısayol (pane_id = 0, payload = []).
    pub fn control(msg_type: MsgType) -> Self {
        Self::new(msg_type, 0, Vec::new())
    }

    /// Frame'i `writer`'a serialize et.
    pub fn encode<W: Write>(&self, writer: &mut W) -> Result<(), ProtocolError> {
        if self.payload.len() > MAX_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge(self.payload.len() as u32));
        }
        writer.write_u32::<BigEndian>(self.payload.len() as u32)?;
        writer.write_u8(self.msg_type as u8)?;
        writer.write_u64::<BigEndian>(self.pane_id)?;
        writer.write_all(&self.payload)?;
        Ok(())
    }

    /// `reader`'dan tek frame oku. EOF → `None`.
    pub fn decode<R: Read>(reader: &mut R) -> Result<Option<Self>, ProtocolError> {
        let len = match reader.read_u32::<BigEndian>() {
            Ok(v) => v,
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => return Ok(None),
            Err(e) => return Err(e.into()),
        };
        if len as usize > MAX_PAYLOAD {
            return Err(ProtocolError::PayloadTooLarge(len));
        }
        let msg_type = MsgType::from_byte(reader.read_u8()?)?;
        let pane_id = reader.read_u64::<BigEndian>()?;
        let mut payload = vec![0u8; len as usize];
        reader.read_exact(&mut payload)?;
        Ok(Some(Self {
            msg_type,
            pane_id,
            payload,
        }))
    }

    /// Bellek bufferi içine encode (test/debug için pratik).
    pub fn to_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut buf = Vec::with_capacity(HEADER_LEN + self.payload.len());
        self.encode(&mut buf)?;
        Ok(buf)
    }

    /// Bellek bufferinden decode.
    pub fn from_bytes(bytes: &[u8]) -> Result<Option<Self>, ProtocolError> {
        let mut cur = Cursor::new(bytes);
        Self::decode(&mut cur)
    }
}

// --- CBOR-kodlu kontrol payload'ları --------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SpawnPayload {
    pub shell: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResizePayload {
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExitPayload {
    pub exit_code: i32,
    #[serde(default)]
    pub signal: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
}

/// Tip-güvenli CBOR encode helper.
pub fn encode_cbor<T: Serialize>(value: &T) -> Result<Vec<u8>, ProtocolError> {
    let mut buf = Vec::new();
    ciborium::into_writer(value, &mut buf)
        .map_err(|e| ProtocolError::CborEncode(e.to_string()))?;
    Ok(buf)
}

/// Tip-güvenli CBOR decode helper.
pub fn decode_cbor<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, ProtocolError> {
    ciborium::from_reader(bytes).map_err(|e| ProtocolError::CborDecode(e.to_string()))
}

// --- Tests -----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_stdout() {
        let original = Frame::new(MsgType::Stdout, 42, b"hello \x1b[32mworld\x1b[0m".to_vec());
        let bytes = original.to_bytes().unwrap();
        assert_eq!(bytes.len(), HEADER_LEN + original.payload.len());
        let decoded = Frame::from_bytes(&bytes).unwrap().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn frame_roundtrip_empty_payload() {
        let original = Frame::control(MsgType::Ping);
        let bytes = original.to_bytes().unwrap();
        assert_eq!(bytes.len(), HEADER_LEN);
        let decoded = Frame::from_bytes(&bytes).unwrap().unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn frame_decode_eof_returns_none() {
        let result = Frame::from_bytes(&[]).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn frame_rejects_oversized_payload() {
        // 32 bit length = 17 MB, MAX_PAYLOAD = 16 MB
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&((MAX_PAYLOAD as u32 + 1).to_be_bytes()));
        bytes.push(MsgType::Stdout as u8);
        bytes.extend_from_slice(&0u64.to_be_bytes());
        let err = Frame::from_bytes(&bytes).unwrap_err();
        matches!(err, ProtocolError::PayloadTooLarge(_));
    }

    #[test]
    fn frame_rejects_unknown_msg_type() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.push(0xFF); // bilinmeyen tip
        bytes.extend_from_slice(&0u64.to_be_bytes());
        let err = Frame::from_bytes(&bytes).unwrap_err();
        matches!(err, ProtocolError::UnknownMsgType(0xFF));
    }

    #[test]
    fn spawn_payload_cbor_roundtrip() {
        let original = SpawnPayload {
            shell: "powershell.exe".to_string(),
            args: vec!["-NoLogo".to_string()],
            cwd: Some("C:\\Users\\engin".to_string()),
            env: vec![("FOO".to_string(), "bar".to_string())],
            cols: 120,
            rows: 30,
        };
        let bytes = encode_cbor(&original).unwrap();
        let decoded: SpawnPayload = decode_cbor(&bytes).unwrap();
        assert_eq!(decoded, original);
    }

    #[test]
    fn full_spawn_frame_roundtrip() {
        let payload = SpawnPayload {
            shell: "cmd.exe".to_string(),
            args: vec![],
            cwd: None,
            env: vec![],
            cols: 80,
            rows: 24,
        };
        let frame = Frame::new(MsgType::Spawn, 1, encode_cbor(&payload).unwrap());
        let bytes = frame.to_bytes().unwrap();
        let decoded = Frame::from_bytes(&bytes).unwrap().unwrap();
        assert_eq!(decoded, frame);
        let decoded_payload: SpawnPayload = decode_cbor(&decoded.payload).unwrap();
        assert_eq!(decoded_payload, payload);
    }

    #[test]
    fn multiple_frames_in_stream() {
        let f1 = Frame::new(MsgType::Stdout, 1, b"first".to_vec());
        let f2 = Frame::new(MsgType::Stdout, 2, b"second".to_vec());
        let f3 = Frame::control(MsgType::Ping);

        let mut buf = Vec::new();
        f1.encode(&mut buf).unwrap();
        f2.encode(&mut buf).unwrap();
        f3.encode(&mut buf).unwrap();

        let mut cur = Cursor::new(&buf[..]);
        assert_eq!(Frame::decode(&mut cur).unwrap().unwrap(), f1);
        assert_eq!(Frame::decode(&mut cur).unwrap().unwrap(), f2);
        assert_eq!(Frame::decode(&mut cur).unwrap().unwrap(), f3);
        assert!(Frame::decode(&mut cur).unwrap().is_none());
    }

    #[test]
    fn binary_safe_payload() {
        // ANSI escape + null byte + UTF-8 emoji bayraklarıyla karışık.
        let payload: Vec<u8> = vec![
            0x1B, b'[', b'3', b'1', b'm', // \e[31m
            0x00, 0xFF, 0xFE,             // null + non-printable
            0xF0, 0x9F, 0x9A, 0x80,       // 🚀
        ];
        let frame = Frame::new(MsgType::Stdout, 99, payload.clone());
        let bytes = frame.to_bytes().unwrap();
        let decoded = Frame::from_bytes(&bytes).unwrap().unwrap();
        assert_eq!(decoded.payload, payload);
    }
}
