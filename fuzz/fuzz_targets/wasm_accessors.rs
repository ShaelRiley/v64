#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_wasm::{
    v64_renderer_abi_version, v64_renderer_fixture_byte, v64_renderer_fixture_fnv_hi,
    v64_renderer_fixture_fnv_lo, v64_renderer_fixture_height, v64_renderer_fixture_len,
    v64_renderer_fixture_width,
};

fuzz_target!(|data: &[u8]| {
    let len = v64_renderer_fixture_len();
    let mut prefix = [0u8; 4];
    for (target, source) in prefix.iter_mut().zip(data.iter().copied()) {
        *target = source;
    }
    let index = u32::from_le_bytes(prefix);
    let _ = v64_renderer_abi_version();
    let _ = v64_renderer_fixture_width();
    let _ = v64_renderer_fixture_height();
    let _ = v64_renderer_fixture_fnv_lo();
    let _ = v64_renderer_fixture_fnv_hi();
    let _ = v64_renderer_fixture_byte(index);
    let _ = v64_renderer_fixture_byte(len.saturating_sub(1));
    assert_eq!(v64_renderer_fixture_byte(len), 256);
    assert_eq!(v64_renderer_fixture_byte(len.saturating_add(1)), 256);
    assert_eq!(v64_renderer_fixture_byte(u32::MAX), 256);
});
