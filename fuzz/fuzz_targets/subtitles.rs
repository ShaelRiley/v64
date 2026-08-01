#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::extensions::{SubtitleLimits, decode_sm2};

fuzz_target!(|data: &[u8]| {
    let _ = decode_sm2(
        data,
        SubtitleLimits {
            expected_frames: None,
            max_frames: 512,
            max_canonical_entries: 16_384,
        },
    );
});
