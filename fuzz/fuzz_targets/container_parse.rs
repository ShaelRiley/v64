#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::{ParseOptions, ResourceLimits, parse_with_resource_limits};

fuzz_target!(|data: &[u8]| {
    let _ = parse_with_resource_limits(
        data,
        ParseOptions::default(),
        ResourceLimits {
            max_inflated_chunk_bytes: 1 << 20,
            max_total_payload_bytes: 2 << 20,
            max_chunks: 4_096,
        },
    );
});
