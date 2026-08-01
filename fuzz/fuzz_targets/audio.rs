#![no_main]

use libfuzzer_sys::fuzz_target;
use v64_core::extensions::{AudioLimits, decode_aurn_payload};

fuzz_target!(|data: &[u8]| {
    if data.len() < 16 {
        return;
    }
    let timestamp = u64::from_le_bytes(data[0..8].try_into().expect("fixed prefix"));
    let duration = u64::from_le_bytes(data[8..16].try_into().expect("fixed prefix"));
    let payload = &data[16..data.len().min((1 << 20) + 16)];
    let _ = decode_aurn_payload(
        payload,
        timestamp,
        duration,
        AudioLimits {
            max_packets: 1_024,
            max_packet_data_bytes: 1 << 20,
        },
    );
});
