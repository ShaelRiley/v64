#![deny(unsafe_code)]

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Mutex, MutexGuard, OnceLock};
use v64_core::decoder::{DECODER_API_VERSION, Decoder, DecoderConfig};
use v64_core::{ParseOptions, ResourceLimits};

pub const V64_ABI_VERSION: u32 = 1;
pub const V64_STATUS_OK: u32 = 0;
pub const V64_STATUS_DONE: u32 = 1;
pub const V64_STATUS_INVALID_ARGUMENT: u32 = 2;
pub const V64_STATUS_LIMIT: u32 = 3;
pub const V64_STATUS_PARSE_ERROR: u32 = 4;
pub const V64_STATUS_DECODE_ERROR: u32 = 5;
pub const V64_STATUS_INVALID_STATE: u32 = 6;
pub const V64_STATUS_INVALID_HANDLE: u32 = 7;
pub const V64_STATUS_PANIC: u32 = 255;
pub const V64_BYTE_ERROR: u32 = 256;
pub const V64_U32_ERROR: u32 = u32::MAX;
pub const V64_U64_ERROR: u64 = u64::MAX;
pub const V64_MAX_SESSIONS: usize = 16;
pub const V64_MAX_INPUT_BYTES: usize = v64_core::MAX_TOTAL_PAYLOAD_BYTES;
const MAX_ERROR_BYTES: usize = 1024;
const SLOT_MASK: u32 = 0xff;
const MAX_GENERATION: u32 = 0x00ff_ffff;

struct Session {
    max_input_bytes: usize,
    max_decoded_bytes: usize,
    input: Vec<u8>,
    decoder: Option<Decoder>,
    last_error: Vec<u8>,
}

impl Session {
    fn new(max_input_bytes: usize, max_decoded_bytes: usize) -> Self {
        Self {
            max_input_bytes,
            max_decoded_bytes,
            input: Vec::new(),
            decoder: None,
            last_error: Vec::new(),
        }
    }

    fn set_error(&mut self, message: impl AsRef<str>) {
        self.last_error.clear();
        let bytes = message.as_ref().as_bytes();
        self.last_error
            .extend_from_slice(&bytes[..bytes.len().min(MAX_ERROR_BYTES)]);
    }

    fn clear_error(&mut self) {
        self.last_error.clear();
    }

    fn reset(&mut self) {
        self.input.clear();
        self.decoder = None;
        self.clear_error();
    }
}

#[derive(Default)]
struct Slot {
    generation: u32,
    session: Option<Session>,
}

struct Registry {
    slots: Vec<Slot>,
}

impl Registry {
    fn new() -> Self {
        Self {
            slots: (0..V64_MAX_SESSIONS).map(|_| Slot::default()).collect(),
        }
    }

    fn create(&mut self, max_input_bytes: usize, max_decoded_bytes: usize) -> u32 {
        let Some((index, slot)) = self
            .slots
            .iter_mut()
            .enumerate()
            .find(|(_, slot)| slot.session.is_none() && slot.generation < MAX_GENERATION)
        else {
            return 0;
        };
        slot.generation += 1;
        slot.session = Some(Session::new(max_input_bytes, max_decoded_bytes));
        (slot.generation << 8) | u32::try_from(index + 1).unwrap_or(0)
    }

    fn session(&self, handle: u32) -> Option<&Session> {
        let (index, generation) = decode_handle(handle)?;
        let slot = self.slots.get(index)?;
        (slot.generation == generation)
            .then_some(slot.session.as_ref())
            .flatten()
    }

    fn session_mut(&mut self, handle: u32) -> Option<&mut Session> {
        let (index, generation) = decode_handle(handle)?;
        let slot = self.slots.get_mut(index)?;
        (slot.generation == generation)
            .then_some(slot.session.as_mut())
            .flatten()
    }

    fn destroy(&mut self, handle: u32) -> bool {
        let Some((index, generation)) = decode_handle(handle) else {
            return false;
        };
        let Some(slot) = self.slots.get_mut(index) else {
            return false;
        };
        if slot.generation != generation || slot.session.is_none() {
            return false;
        }
        slot.session = None;
        true
    }
}

static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();

fn registry() -> MutexGuard<'static, Registry> {
    REGISTRY
        .get_or_init(|| Mutex::new(Registry::new()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn decode_handle(handle: u32) -> Option<(usize, u32)> {
    let raw_slot = usize::try_from(handle & SLOT_MASK).ok()?;
    let generation = handle >> 8;
    if raw_slot == 0 || raw_slot > V64_MAX_SESSIONS || generation == 0 {
        return None;
    }
    Some((raw_slot - 1, generation))
}

fn catch_u32(fallback: u32, operation: impl FnOnce() -> u32) -> u32 {
    catch_unwind(AssertUnwindSafe(operation)).unwrap_or(fallback)
}

fn catch_u64(operation: impl FnOnce() -> u64) -> u64 {
    catch_unwind(AssertUnwindSafe(operation)).unwrap_or(V64_U64_ERROR)
}

fn create_impl(max_input_bytes: u32, max_decoded_bytes: u32) -> u32 {
    let max_input = usize::try_from(max_input_bytes).unwrap_or(usize::MAX);
    let max_decoded = usize::try_from(max_decoded_bytes).unwrap_or(usize::MAX);
    if max_input == 0
        || max_input > V64_MAX_INPUT_BYTES
        || max_decoded == 0
        || max_decoded > v64_core::MAX_TOTAL_PAYLOAD_BYTES
    {
        return 0;
    }
    registry().create(max_input, max_decoded)
}

fn reset_impl(handle: u32) -> u32 {
    let mut registry = registry();
    let Some(session) = registry.session_mut(handle) else {
        return V64_STATUS_INVALID_HANDLE;
    };
    session.reset();
    V64_STATUS_OK
}

fn destroy_impl(handle: u32) -> u32 {
    if registry().destroy(handle) {
        V64_STATUS_OK
    } else {
        V64_STATUS_INVALID_HANDLE
    }
}

fn push_byte_impl(handle: u32, byte: u32) -> u32 {
    if byte > 255 {
        return V64_STATUS_INVALID_ARGUMENT;
    }
    let mut registry = registry();
    let Some(session) = registry.session_mut(handle) else {
        return V64_STATUS_INVALID_HANDLE;
    };
    if session.decoder.is_some() {
        session.set_error("decoder input is already finalized");
        return V64_STATUS_INVALID_STATE;
    }
    if session.input.len() >= session.max_input_bytes {
        session.set_error("decoder input exceeds configured limit");
        return V64_STATUS_LIMIT;
    }
    session.input.push(byte as u8);
    session.clear_error();
    V64_STATUS_OK
}

fn push_word_impl(handle: u32, word: u32, byte_count: u32) -> u32 {
    if !(1..=4).contains(&byte_count) {
        return V64_STATUS_INVALID_ARGUMENT;
    }
    let mut registry = registry();
    let Some(session) = registry.session_mut(handle) else {
        return V64_STATUS_INVALID_HANDLE;
    };
    if session.decoder.is_some() {
        session.set_error("decoder input is already finalized");
        return V64_STATUS_INVALID_STATE;
    }
    let count = usize::try_from(byte_count).unwrap_or(usize::MAX);
    if session
        .input
        .len()
        .checked_add(count)
        .is_none_or(|length| length > session.max_input_bytes)
    {
        session.set_error("decoder input exceeds configured limit");
        return V64_STATUS_LIMIT;
    }
    let bytes = word.to_le_bytes();
    session.input.extend_from_slice(&bytes[..count]);
    session.clear_error();
    V64_STATUS_OK
}

fn finish_impl(handle: u32) -> u32 {
    let mut registry = registry();
    let Some(session) = registry.session_mut(handle) else {
        return V64_STATUS_INVALID_HANDLE;
    };
    if session.decoder.is_some() {
        session.set_error("decoder input is already finalized");
        return V64_STATUS_INVALID_STATE;
    }
    let limits = ResourceLimits {
        max_inflated_chunk_bytes: session.max_decoded_bytes,
        max_total_payload_bytes: session.max_decoded_bytes,
        ..ResourceLimits::default()
    };
    match Decoder::from_bytes_with_config(
        &session.input,
        DecoderConfig {
            parse_options: ParseOptions::default(),
            resource_limits: limits,
        },
    ) {
        Ok(decoder) => {
            session.decoder = Some(decoder);
            session.input.clear();
            session.input.shrink_to_fit();
            session.clear_error();
            V64_STATUS_OK
        }
        Err(error) => {
            session.set_error(error.to_string());
            V64_STATUS_PARSE_ERROR
        }
    }
}

fn advance_impl(handle: u32) -> u32 {
    let mut registry = registry();
    let Some(session) = registry.session_mut(handle) else {
        return V64_STATUS_INVALID_HANDLE;
    };
    let Some(decoder) = session.decoder.as_mut() else {
        session.set_error("decoder input is not finalized");
        return V64_STATUS_INVALID_STATE;
    };
    match decoder.advance() {
        Ok(Some(_)) => {
            session.clear_error();
            V64_STATUS_OK
        }
        Ok(None) => {
            session.clear_error();
            V64_STATUS_DONE
        }
        Err(error) => {
            session.set_error(error.to_string());
            V64_STATUS_DECODE_ERROR
        }
    }
}

fn header_u32(handle: u32, value: impl FnOnce(&v64_core::Header) -> u32) -> u32 {
    let registry = registry();
    let Some(decoder) = registry
        .session(handle)
        .and_then(|session| session.decoder.as_ref())
    else {
        return V64_U32_ERROR;
    };
    value(decoder.header())
}

fn header_u64(handle: u32, value: impl FnOnce(&v64_core::Header) -> u64) -> u64 {
    let registry = registry();
    let Some(decoder) = registry
        .session(handle)
        .and_then(|session| session.decoder.as_ref())
    else {
        return V64_U64_ERROR;
    };
    value(decoder.header())
}

fn frame_u32(handle: u32, value: impl FnOnce(v64_core::decoder::FrameInfo, &[u8]) -> u32) -> u32 {
    let registry = registry();
    let Some(decoder) = registry
        .session(handle)
        .and_then(|session| session.decoder.as_ref())
    else {
        return V64_U32_ERROR;
    };
    let (Some(info), Some(state)) = (decoder.current_frame(), decoder.current_state()) else {
        return V64_U32_ERROR;
    };
    value(info, state)
}

fn frame_u64(handle: u32, value: impl FnOnce(v64_core::decoder::FrameInfo) -> u64) -> u64 {
    let registry = registry();
    let Some(info) = registry
        .session(handle)
        .and_then(|session| session.decoder.as_ref())
        .and_then(Decoder::current_frame)
    else {
        return V64_U64_ERROR;
    };
    value(info)
}

fn state_byte_impl(handle: u32, index: u32) -> u32 {
    frame_u32(handle, |_, state| {
        usize::try_from(index)
            .ok()
            .and_then(|offset| state.get(offset))
            .map_or(V64_BYTE_ERROR, |byte| u32::from(*byte))
    })
}

fn error_length_impl(handle: u32) -> u32 {
    let registry = registry();
    registry
        .session(handle)
        .and_then(|session| u32::try_from(session.last_error.len()).ok())
        .unwrap_or(V64_U32_ERROR)
}

fn error_byte_impl(handle: u32, index: u32) -> u32 {
    let registry = registry();
    let Some(session) = registry.session(handle) else {
        return V64_BYTE_ERROR;
    };
    usize::try_from(index)
        .ok()
        .and_then(|offset| session.last_error.get(offset))
        .map_or(V64_BYTE_ERROR, |byte| u32::from(*byte))
}

// Rust 2024 classifies exported symbol names as unsafe attributes. Each
// one-expression wrapper allows only that required attribute; all decoder logic
// remains in safe functions under the crate-level unsafe-code denial.
#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_abi_version() -> u32 {
    V64_ABI_VERSION
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_api_version() -> u32 {
    DECODER_API_VERSION
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_create(max_input_bytes: u32, max_decoded_bytes: u32) -> u32 {
    catch_u32(0, || create_impl(max_input_bytes, max_decoded_bytes))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_reset(handle: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || reset_impl(handle))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_destroy(handle: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || destroy_impl(handle))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_push_byte(handle: u32, byte: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || push_byte_impl(handle, byte))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_push_word_le(handle: u32, word: u32, byte_count: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || {
        push_word_impl(handle, word, byte_count)
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_finish(handle: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || finish_impl(handle))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_advance(handle: u32) -> u32 {
    catch_u32(V64_STATUS_PANIC, || advance_impl(handle))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_columns(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        header_u32(handle, |header| u32::from(header.columns))
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_rows(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        header_u32(handle, |header| u32::from(header.rows))
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_palette_depth(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        header_u32(handle, |header| u32::from(header.palette_depth))
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_frame_ticks(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        header_u32(handle, |header| header.cadence.frame_ticks)
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_duration_ticks(handle: u32) -> u64 {
    catch_u64(|| header_u64(handle, |header| header.duration_ticks))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_video_record_count(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        let registry = registry();
        registry
            .session(handle)
            .and_then(|session| session.decoder.as_ref())
            .map_or(V64_U32_ERROR, Decoder::video_record_count)
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_frame_timestamp(handle: u32) -> u64 {
    catch_u64(|| frame_u64(handle, |info| info.timestamp))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_frame_duration(handle: u32) -> u64 {
    catch_u64(|| frame_u64(handle, |info| info.duration))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_frame_flags(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        frame_u32(handle, |info, _| {
            u32::from(info.keyframe) | (u32::from(info.repeat) << 1)
        })
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_state_length(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || {
        frame_u32(handle, |_, state| {
            u32::try_from(state.len()).unwrap_or(V64_U32_ERROR)
        })
    })
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_state_byte(handle: u32, index: u32) -> u32 {
    catch_u32(V64_BYTE_ERROR, || state_byte_impl(handle, index))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_error_length(handle: u32) -> u32 {
    catch_u32(V64_U32_ERROR, || error_length_impl(handle))
}

#[allow(unsafe_code)]
#[unsafe(no_mangle)]
pub extern "C" fn v64_decoder_error_byte(handle: u32, index: u32) -> u32 {
    catch_u32(V64_BYTE_ERROR, || error_byte_impl(handle, index))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../tests/golden/procedural.v64");
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn scalar_abi_decodes_and_rejects_out_of_range_access() {
        let _guard = TEST_LOCK.lock().expect("test lock should remain usable");
        let handle = v64_decoder_create(1_048_576, 1_048_576);
        assert_ne!(handle, 0);
        for bytes in PROCEDURAL.chunks(4) {
            let mut word = [0u8; 4];
            word[..bytes.len()].copy_from_slice(bytes);
            assert_eq!(
                v64_decoder_push_word_le(
                    handle,
                    u32::from_le_bytes(word),
                    u32::try_from(bytes.len()).unwrap()
                ),
                V64_STATUS_OK
            );
        }
        assert_eq!(v64_decoder_finish(handle), V64_STATUS_OK);
        assert_eq!(v64_decoder_columns(handle), 40);
        assert_eq!(v64_decoder_rows(handle), 11);
        assert_eq!(v64_decoder_advance(handle), V64_STATUS_OK);
        let length = v64_decoder_state_length(handle);
        assert_eq!(length, 1_320);
        assert!(v64_decoder_state_byte(handle, 0) <= 255);
        assert_eq!(v64_decoder_state_byte(handle, length), V64_BYTE_ERROR);
        assert_eq!(v64_decoder_reset(handle), V64_STATUS_OK);
        assert_eq!(v64_decoder_destroy(handle), V64_STATUS_OK);
        assert_eq!(
            v64_decoder_destroy(handle),
            V64_STATUS_INVALID_HANDLE,
            "stale handles must fail closed"
        );
    }

    #[test]
    fn configured_input_limit_is_transactional() {
        let _guard = TEST_LOCK.lock().expect("test lock should remain usable");
        let handle = v64_decoder_create(2, 1024);
        assert_ne!(handle, 0);
        assert_eq!(v64_decoder_push_word_le(handle, 0x0000_3456, 2), V64_STATUS_OK);
        assert_eq!(
            v64_decoder_push_byte(handle, 0),
            V64_STATUS_LIMIT,
            "one byte beyond the configured limit must fail"
        );
        assert_eq!(v64_decoder_destroy(handle), V64_STATUS_OK);
    }

    #[test]
    fn malformed_input_can_be_reset_and_followed_by_valid_recovery() {
        let _guard = TEST_LOCK.lock().expect("test lock should remain usable");
        let handle = v64_decoder_create(1_048_576, 1_048_576);
        assert_ne!(handle, 0);
        for _ in 0..64 {
            assert_eq!(v64_decoder_push_byte(handle, 0), V64_STATUS_OK);
            assert_eq!(v64_decoder_finish(handle), V64_STATUS_PARSE_ERROR);
            assert!(v64_decoder_error_length(handle) > 0);
            assert_eq!(v64_decoder_reset(handle), V64_STATUS_OK);
        }
        for byte in PROCEDURAL {
            assert_eq!(
                v64_decoder_push_byte(handle, u32::from(*byte)),
                V64_STATUS_OK
            );
        }
        assert_eq!(v64_decoder_finish(handle), V64_STATUS_OK);
        assert_eq!(v64_decoder_advance(handle), V64_STATUS_OK);
        assert_eq!(v64_decoder_destroy(handle), V64_STATUS_OK);
    }

    #[test]
    fn live_session_count_and_configuration_are_bounded() {
        let _guard = TEST_LOCK.lock().expect("test lock should remain usable");
        assert_eq!(v64_decoder_create(0, 1), 0);
        assert_eq!(v64_decoder_create(1, 0), 0);
        assert_eq!(v64_decoder_create(u32::MAX, 1), 0);
        let handles = (0..V64_MAX_SESSIONS)
            .map(|_| v64_decoder_create(1, 1))
            .collect::<Vec<_>>();
        assert!(handles.iter().all(|handle| *handle != 0));
        assert_eq!(v64_decoder_create(1, 1), 0);
        for handle in handles {
            assert_eq!(v64_decoder_destroy(handle), V64_STATUS_OK);
        }
    }
}
