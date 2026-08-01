#![forbid(unsafe_code)]

pub mod decoder;
pub mod extensions;
pub mod frame;
pub mod grammar_b;
pub mod renderer;

use flate2::read::DeflateDecoder;
use serde_json::Value;
use std::fmt::{Display, Formatter};
use std::io::Read;

pub const MAGIC: [u8; 8] = [0x56, 0x36, 0x34, 0x00, 0x0d, 0x0a, 0x1a, 0x0a];
pub const HEADER_SIZE: usize = 128;
pub const CHUNK_HEADER_SIZE: usize = 32;
pub const TICK_RATE: u32 = 60_000;
pub const MAX_COLUMNS: u16 = 512;
pub const MAX_ROWS: u16 = 512;
pub const MAX_CELLS: usize = 262_144;
pub const MAX_STORED_CHUNK: usize = 64 * 1024 * 1024;
pub const MAX_INFLATED_CHUNK: usize = 1024 * 1024 * 1024;
pub const MAX_TOTAL_PAYLOAD_BYTES: usize = 1024 * 1024 * 1024;
pub const MAX_CHUNKS: u32 = 10_000_000;
pub const MAX_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

const FLAG_CRC: u32 = 1;
const FLAG_DEFLATE: u32 = 2;
const KNOWN_FEATURE_MASK: u32 = 0xff;
const KNOWN_CHUNKS: [&str; 8] = [
    "VFRM", "RPTF", "AURN", "SILN", "SUBT", "PLIT", "META", "INDX",
];
const PALETTE_DEPTHS: [u16; 14] = [2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 256];
const CADENCES: [Cadence; 11] = [
    Cadence::new(0, "0.10", 1, 10, 600_000),
    Cadence::new(1, "0.5", 1, 2, 120_000),
    Cadence::new(2, "1", 1, 1, 60_000),
    Cadence::new(3, "3", 3, 1, 20_000),
    Cadence::new(4, "6", 6, 1, 10_000),
    Cadence::new(5, "12", 12, 1, 5_000),
    Cadence::new(6, "15", 15, 1, 4_000),
    Cadence::new(7, "24", 24, 1, 2_500),
    Cadence::new(8, "30", 30, 1, 2_000),
    Cadence::new(9, "48", 48, 1, 1_250),
    Cadence::new(10, "60", 60, 1, 1_000),
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error(String);

impl Error {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }

    pub fn message(&self) -> &str {
        &self.0
    }
}

impl Display for Error {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(error: std::io::Error) -> Self {
        Self::new(error.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(error: serde_json::Error) -> Self {
        Self::new(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cadence {
    pub id: u8,
    pub label: &'static str,
    pub numerator: u32,
    pub denominator: u32,
    pub frame_ticks: u32,
}

impl Cadence {
    const fn new(
        id: u8,
        label: &'static str,
        numerator: u32,
        denominator: u32,
        frame_ticks: u32,
    ) -> Self {
        Self {
            id,
            label,
            numerator,
            denominator,
            frame_ticks,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ParseOptions {
    pub expected_glyph_hash: Option<[u8; 32]>,
    pub expected_palette_hash: Option<[u8; 32]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResourceLimits {
    pub max_inflated_chunk_bytes: usize,
    pub max_total_payload_bytes: usize,
    pub max_chunks: u32,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_inflated_chunk_bytes: MAX_INFLATED_CHUNK,
            max_total_payload_bytes: MAX_TOTAL_PAYLOAD_BYTES,
            max_chunks: MAX_CHUNKS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Header {
    pub version_major: u8,
    pub version_minor: u8,
    pub feature_flags: u32,
    pub columns: u16,
    pub rows: u16,
    pub cadence: Cadence,
    pub palette_depth_id: u8,
    pub palette_depth: u16,
    pub duration_ticks: u64,
    pub glyph_hash: [u8; 32],
    pub palette_hash: [u8; 32],
    pub index_offset: u64,
    pub index_length: u32,
    pub chunk_count: u32,
    pub maximum_stored: u32,
    pub glyph_asset_id: u32,
    pub palette_asset_id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    pub chunk_type: String,
    pub flags: u32,
    pub timestamp: u64,
    pub duration: u64,
    pub payload: Vec<u8>,
    pub offset: u64,
    pub stored_length: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IndexEntry {
    pub timestamp: u64,
    pub offset: u64,
    pub keyframe: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct V64File {
    pub header: Header,
    pub chunks: Vec<Chunk>,
    pub index: Vec<IndexEntry>,
}

impl V64File {
    pub fn encoder_profile(&self) -> Result<Option<Value>> {
        let mut profile = None;
        for chunk in self
            .chunks
            .iter()
            .filter(|chunk| chunk.chunk_type == "META")
        {
            let value: Value = serde_json::from_slice(&chunk.payload)?;
            if value.get("format").and_then(Value::as_str) != Some("V64-ENCODER-PROFILE-1") {
                continue;
            }
            if profile.is_some() {
                return Err(Error::new("Multiple V64 encoder-profile records"));
            }
            profile = Some(value);
        }
        Ok(profile)
    }
}

pub fn parse(input: &[u8]) -> Result<V64File> {
    parse_with_options(input, ParseOptions::default())
}

pub fn parse_with_options(input: &[u8], options: ParseOptions) -> Result<V64File> {
    parse_with_resource_limits(input, options, ResourceLimits::default())
}

pub fn parse_with_resource_limits(
    input: &[u8],
    options: ParseOptions,
    limits: ResourceLimits,
) -> Result<V64File> {
    if limits.max_inflated_chunk_bytes == 0
        || limits.max_inflated_chunk_bytes > MAX_INFLATED_CHUNK
        || limits.max_total_payload_bytes == 0
        || limits.max_total_payload_bytes > MAX_TOTAL_PAYLOAD_BYTES
        || limits.max_chunks == 0
        || limits.max_chunks > MAX_CHUNKS
    {
        return Err(Error::new(
            "Configured resource limits lie outside the supported range",
        ));
    }
    let header = parse_header(input, options)?;
    if header.chunk_count > limits.max_chunks {
        return Err(Error::new("Declared chunk count exceeds configured limit"));
    }
    let declared_chunks = usize::try_from(header.chunk_count)
        .map_err(|_| Error::new("Chunk count exceeds platform range"))?;
    let mut chunks = Vec::with_capacity(declared_chunks.min(4096));
    let mut offset = HEADER_SIZE;
    let mut total_payload_bytes = 0usize;

    for _ in 0..declared_chunks {
        let chunk_header_end = checked_add(offset, CHUNK_HEADER_SIZE, "Chunk header range")?;
        if chunk_header_end > input.len() {
            return Err(Error::new("Truncated chunk header"));
        }

        let chunk_type_bytes = &input[offset..offset + 4];
        validate_chunk_type(chunk_type_bytes)?;
        let chunk_type = std::str::from_utf8(chunk_type_bytes)
            .map_err(|_| Error::new("Invalid chunk type"))?
            .to_owned();
        let flags = read_u32(input, offset + 4)?;
        if flags & !(FLAG_CRC | FLAG_DEFLATE) != 0 {
            return Err(Error::new(format!(
                "Unknown mandatory flags on {chunk_type}"
            )));
        }
        let timestamp = checked_js_safe(read_u64(input, offset + 8)?, "Chunk timestamp")?;
        let duration = checked_js_safe(read_u64(input, offset + 16)?, "Chunk duration")?;
        let stored_length = read_u32(input, offset + 24)?;
        let stored_length_usize = usize::try_from(stored_length)
            .map_err(|_| Error::new("Stored chunk length exceeds platform range"))?;
        if stored_length_usize > MAX_STORED_CHUNK {
            return Err(Error::new(format!(
                "Truncated or oversized {chunk_type} payload"
            )));
        }
        let payload_end =
            checked_add(chunk_header_end, stored_length_usize, "Chunk payload range")?;
        if payload_end > input.len() {
            return Err(Error::new(format!(
                "Truncated or oversized {chunk_type} payload"
            )));
        }
        let stored = &input[chunk_header_end..payload_end];
        if flags & FLAG_CRC != 0 {
            let expected_crc = read_u32(input, offset + 28)?;
            if crc32(stored) != expected_crc {
                return Err(Error::new(format!("{chunk_type} CRC mismatch")));
            }
        }

        let payload = if flags & FLAG_DEFLATE != 0 {
            inflate_bounded(stored, &chunk_type, limits.max_inflated_chunk_bytes)?
        } else {
            stored.to_vec()
        };
        total_payload_bytes = total_payload_bytes
            .checked_add(payload.len())
            .ok_or_else(|| Error::new("Decoded payload byte total overflow"))?;
        if total_payload_bytes > limits.max_total_payload_bytes {
            return Err(Error::new(
                "Decoded payload byte total exceeds configured limit",
            ));
        }

        if KNOWN_CHUNKS.contains(&chunk_type.as_str()) {
            chunks.push(Chunk {
                chunk_type,
                flags,
                timestamp,
                duration,
                payload,
                offset: u64::try_from(offset)
                    .map_err(|_| Error::new("Chunk offset exceeds u64"))?,
                stored_length,
            });
        } else if chunk_type.to_ascii_uppercase() == chunk_type {
            return Err(Error::new(format!("Unknown mandatory chunk {chunk_type}")));
        }

        offset = payload_end;
    }

    if offset != input.len() {
        return Err(Error::new("Trailing bytes after declared chunks"));
    }

    let index_chunks: Vec<&Chunk> = chunks
        .iter()
        .filter(|chunk| chunk.chunk_type == "INDX")
        .collect();
    if index_chunks.len() != 1 {
        return Err(Error::new("Header/index disagreement"));
    }
    let index_chunk = index_chunks[0];
    let expected_index_length = checked_add(
        CHUNK_HEADER_SIZE,
        usize::try_from(index_chunk.stored_length)
            .map_err(|_| Error::new("Index stored length exceeds platform range"))?,
        "Index length",
    )?;
    if index_chunk.offset != header.index_offset
        || u32::try_from(expected_index_length).ok() != Some(header.index_length)
    {
        return Err(Error::new("Header/index disagreement"));
    }

    let index = parse_index(&index_chunk.payload)?;
    validate_index(&index, &chunks)?;

    Ok(V64File {
        header,
        chunks,
        index,
    })
}

fn parse_header(input: &[u8], options: ParseOptions) -> Result<Header> {
    if input.len() < HEADER_SIZE {
        return Err(Error::new("Truncated V64 header"));
    }
    if input[..8] != MAGIC {
        return Err(Error::new("V64 magic mismatch"));
    }
    let version_major = input[8];
    let version_minor = input[9];
    if version_major != 0 || version_minor != 1 {
        return Err(Error::new(format!(
            "Unsupported V64 version {version_major}.{version_minor}"
        )));
    }
    if usize::from(read_u16(input, 10)?) != HEADER_SIZE {
        return Err(Error::new("Unsupported V64 header size"));
    }
    let feature_flags = read_u32(input, 12)?;
    if feature_flags & !KNOWN_FEATURE_MASK != 0 {
        return Err(Error::new("Unknown mandatory header feature bits"));
    }
    let columns = read_u16(input, 16)?;
    let rows = read_u16(input, 18)?;
    let cell_count = usize::from(columns)
        .checked_mul(usize::from(rows))
        .ok_or_else(|| Error::new("Invalid or oversized V64 grid"))?;
    if columns == 0
        || rows == 0
        || columns > MAX_COLUMNS
        || rows > MAX_ROWS
        || cell_count > MAX_CELLS
    {
        return Err(Error::new("Invalid or oversized V64 grid"));
    }
    let cadence = cadence_from_id(input[20])?;
    let palette_depth_id = input[21];
    let palette_depth = palette_depth_from_id(palette_depth_id)?;
    if input[22] != 0 {
        return Err(Error::new("Unsupported mandatory glyph coding mode"));
    }
    if input[23] != 0 {
        return Err(Error::new("Nonzero reserved header byte"));
    }
    if read_u32(input, 24)? != TICK_RATE {
        return Err(Error::new("Unsupported timeline tick rate"));
    }
    let duration_ticks = checked_js_safe(read_u64(input, 28)?, "Duration")?;
    let glyph_hash = read_array_32(input, 36)?;
    let palette_hash = read_array_32(input, 68)?;
    if options
        .expected_glyph_hash
        .is_some_and(|expected| expected != glyph_hash)
    {
        return Err(Error::new("Canonical glyph asset hash mismatch"));
    }
    if options
        .expected_palette_hash
        .is_some_and(|expected| expected != palette_hash)
    {
        return Err(Error::new("Master palette asset hash mismatch"));
    }
    let index_offset = checked_js_safe(read_u64(input, 100)?, "Index offset")?;
    let index_length = read_u32(input, 108)?;
    let chunk_count = read_u32(input, 112)?;
    let maximum_stored = read_u32(input, 116)?;
    let glyph_asset_id = read_u32(input, 120)?;
    let palette_asset_id = read_u32(input, 124)?;
    if chunk_count == 0 || chunk_count > MAX_CHUNKS {
        return Err(Error::new("Invalid chunk count"));
    }
    if usize::try_from(maximum_stored).map_or(true, |value| value > MAX_STORED_CHUNK) {
        return Err(Error::new("Declared maximum chunk exceeds decoder limit"));
    }
    if glyph_asset_id != 1 || palette_asset_id != 1 {
        return Err(Error::new("Unsupported mandatory asset identifier"));
    }
    let index_start = usize::try_from(index_offset)
        .map_err(|_| Error::new("Index offset exceeds platform range"))?;
    let index_end = checked_add(
        index_start,
        usize::try_from(index_length)
            .map_err(|_| Error::new("Index length exceeds platform range"))?,
        "Index range",
    )?;
    if index_start < HEADER_SIZE || index_end > input.len() {
        return Err(Error::new("Index range lies outside file"));
    }

    Ok(Header {
        version_major,
        version_minor,
        feature_flags,
        columns,
        rows,
        cadence,
        palette_depth_id,
        palette_depth,
        duration_ticks,
        glyph_hash,
        palette_hash,
        index_offset,
        index_length,
        chunk_count,
        maximum_stored,
        glyph_asset_id,
        palette_asset_id,
    })
}

fn parse_index(payload: &[u8]) -> Result<Vec<IndexEntry>> {
    if payload.len() < 4 {
        return Err(Error::new("Truncated index"));
    }
    let count = usize::try_from(read_u32(payload, 0)?)
        .map_err(|_| Error::new("Index count exceeds platform range"))?;
    let expected = checked_add(
        4,
        count
            .checked_mul(20)
            .ok_or_else(|| Error::new("Index payload length overflow"))?,
        "Index payload length",
    )?;
    if payload.len() != expected {
        return Err(Error::new("Index payload length mismatch"));
    }
    let mut entries = Vec::with_capacity(count.min(4096));
    let mut offset = 4;
    for _ in 0..count {
        let timestamp = checked_js_safe(read_u64(payload, offset)?, "Index timestamp")?;
        let file_offset = checked_js_safe(read_u64(payload, offset + 8)?, "Indexed file offset")?;
        let flags = read_u32(payload, offset + 16)?;
        if flags & !1 != 0 {
            return Err(Error::new("Unknown index flags"));
        }
        entries.push(IndexEntry {
            timestamp,
            offset: file_offset,
            keyframe: flags & 1 != 0,
        });
        offset += 20;
    }
    Ok(entries)
}

fn validate_index(entries: &[IndexEntry], chunks: &[Chunk]) -> Result<()> {
    for entry in entries {
        let target = chunks.iter().find(|chunk| chunk.offset == entry.offset);
        let Some(target) = target else {
            return Err(Error::new("Index entry does not reference a keyframe"));
        };
        if target.chunk_type != "VFRM"
            || target.payload.first().copied() != Some(0)
            || !entry.keyframe
        {
            return Err(Error::new("Index entry does not reference a keyframe"));
        }
        if target.timestamp != entry.timestamp {
            return Err(Error::new("Index timestamp disagreement"));
        }
    }
    Ok(())
}

fn inflate_bounded(
    stored: &[u8],
    chunk_type: &str,
    max_inflated_chunk_bytes: usize,
) -> Result<Vec<u8>> {
    let decoder = DeflateDecoder::new(stored);
    let limit = u64::try_from(max_inflated_chunk_bytes)
        .map_err(|_| Error::new("Inflated-chunk limit exceeds u64"))?;
    let mut limited = decoder.take(limit + 1);
    let mut payload = Vec::new();
    limited
        .read_to_end(&mut payload)
        .map_err(|error| Error::new(format!("Invalid compressed {chunk_type} payload: {error}")))?;
    if payload.len() > max_inflated_chunk_bytes {
        return Err(Error::new(format!(
            "Invalid or excessive compressed {chunk_type} payload"
        )));
    }
    Ok(payload)
}

fn cadence_from_id(id: u8) -> Result<Cadence> {
    CADENCES
        .get(usize::from(id))
        .copied()
        .filter(|cadence| cadence.id == id)
        .ok_or_else(|| Error::new(format!("Illegal V64 cadence ID {id}")))
}

fn palette_depth_from_id(id: u8) -> Result<u16> {
    PALETTE_DEPTHS
        .get(usize::from(id))
        .copied()
        .ok_or_else(|| Error::new(format!("Illegal V64 palette-depth ID {id}")))
}

fn validate_chunk_type(bytes: &[u8]) -> Result<()> {
    if bytes.len() != 4 || !bytes.iter().all(|byte| (0x21..=0x7e).contains(byte)) {
        return Err(Error::new("Invalid chunk type"));
    }
    Ok(())
}

fn checked_js_safe(value: u64, label: &str) -> Result<u64> {
    if value > MAX_JS_SAFE_INTEGER {
        return Err(Error::new(format!(
            "{label} exceeds JavaScript safe integer range"
        )));
    }
    Ok(value)
}

fn checked_add(left: usize, right: usize, label: &str) -> Result<usize> {
    left.checked_add(right)
        .ok_or_else(|| Error::new(format!("{label} overflow")))
}

fn read_u16(input: &[u8], offset: usize) -> Result<u16> {
    let bytes = input
        .get(offset..offset + 2)
        .ok_or_else(|| Error::new("Truncated integer field"))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(input: &[u8], offset: usize) -> Result<u32> {
    let bytes = input
        .get(offset..offset + 4)
        .ok_or_else(|| Error::new("Truncated integer field"))?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u64(input: &[u8], offset: usize) -> Result<u64> {
    let bytes = input
        .get(offset..offset + 8)
        .ok_or_else(|| Error::new("Truncated integer field"))?;
    Ok(u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

fn read_array_32(input: &[u8], offset: usize) -> Result<[u8; 32]> {
    input
        .get(offset..offset + 32)
        .ok_or_else(|| Error::new("Truncated asset hash"))?
        .try_into()
        .map_err(|_| Error::new("Truncated asset hash"))
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../tests/golden/procedural.v64");

    #[test]
    fn parses_the_javascript_golden_container() {
        let file = parse(PROCEDURAL).expect("golden fixture should parse");
        assert_eq!(
            (file.header.version_major, file.header.version_minor),
            (0, 1)
        );
        assert_eq!(
            file.header.cadence.frame_ticks,
            TICK_RATE / file.header.cadence.numerator
        );
        assert!(file.header.columns > 0);
        assert!(file.header.rows > 0);
        assert_eq!(
            file.chunks.len(),
            usize::try_from(file.header.chunk_count).unwrap()
        );
        assert_eq!(
            file.chunks
                .iter()
                .filter(|chunk| chunk.chunk_type == "INDX")
                .count(),
            1
        );
        assert!(!file.index.is_empty());
    }

    #[test]
    fn exact_asset_hash_options_accept_the_golden_header() {
        let parsed = parse(PROCEDURAL).expect("golden fixture should parse");
        let options = ParseOptions {
            expected_glyph_hash: Some(parsed.header.glyph_hash),
            expected_palette_hash: Some(parsed.header.palette_hash),
        };
        parse_with_options(PROCEDURAL, options).expect("matching assets should parse");
    }

    #[test]
    fn mismatched_asset_hash_fails_closed() {
        let parsed = parse(PROCEDURAL).expect("golden fixture should parse");
        let mut wrong = parsed.header.glyph_hash;
        wrong[0] ^= 0xff;
        let error = parse_with_options(
            PROCEDURAL,
            ParseOptions {
                expected_glyph_hash: Some(wrong),
                expected_palette_hash: None,
            },
        )
        .expect_err("wrong asset identity must fail");
        assert!(error.to_string().contains("glyph asset hash mismatch"));
    }

    #[test]
    fn malformed_headers_and_trailing_data_fail_closed() {
        let mut magic = PROCEDURAL.to_vec();
        magic[0] ^= 0xff;
        assert!(
            parse(&magic)
                .unwrap_err()
                .to_string()
                .contains("magic mismatch")
        );

        let mut grid = PROCEDURAL.to_vec();
        grid[16] = 0;
        grid[17] = 0;
        assert!(parse(&grid).unwrap_err().to_string().contains("grid"));

        let mut trailing = PROCEDURAL.to_vec();
        trailing.push(0);
        assert!(
            parse(&trailing)
                .unwrap_err()
                .to_string()
                .contains("Trailing bytes")
        );
    }

    #[test]
    fn stored_payload_crc_is_checked() {
        let mut corrupt = PROCEDURAL.to_vec();
        let last = corrupt.len() - 1;
        corrupt[last] ^= 0x01;
        assert!(
            parse(&corrupt)
                .unwrap_err()
                .to_string()
                .contains("CRC mismatch")
        );
    }

    #[test]
    fn encoder_profile_inspection_is_bounded_and_optional() {
        let file = parse(PROCEDURAL).expect("golden fixture should parse");
        let profile = file
            .encoder_profile()
            .expect("metadata should be valid JSON when present");
        if let Some(profile) = profile {
            assert_eq!(
                profile.get("format").and_then(Value::as_str),
                Some("V64-ENCODER-PROFILE-1")
            );
        }
    }

    #[test]
    fn runtime_inflate_limit_accepts_the_boundary_and_rejects_one_byte_below() {
        use flate2::Compression;
        use flate2::write::DeflateEncoder;
        use std::io::Write;

        let expanded = vec![b'A'; 65_536];
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
        encoder
            .write_all(&expanded)
            .expect("compression should succeed");
        let compressed = encoder.finish().expect("compression should finish");
        let container = compressed_meta_container(&compressed);

        parse(&container).expect("default hard limit should accept the fixture");
        parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len(),
                ..ResourceLimits::default()
            },
        )
        .expect("the exact configured output boundary should be accepted");

        let error = parse_with_resource_limits(
            &container,
            ParseOptions::default(),
            ResourceLimits {
                max_inflated_chunk_bytes: expanded.len() - 1,
                ..ResourceLimits::default()
            },
        )
        .expect_err("one byte below the expanded size must fail closed");
        assert!(
            error
                .to_string()
                .contains("excessive compressed META payload")
        );
    }

    #[test]
    fn runtime_inflate_limit_cannot_disable_or_exceed_the_hard_ceiling() {
        for limit in [0, MAX_INFLATED_CHUNK + 1] {
            let error = parse_with_resource_limits(
                PROCEDURAL,
                ParseOptions::default(),
                ResourceLimits {
                    max_inflated_chunk_bytes: limit,
                    ..ResourceLimits::default()
                },
            )
            .expect_err("invalid resource limits must fail before parsing");
            assert!(error.to_string().contains("outside the supported range"));
        }
    }

    fn compressed_meta_container(compressed: &[u8]) -> Vec<u8> {
        let index_payload = 0u32.to_le_bytes();
        let index_offset = HEADER_SIZE + CHUNK_HEADER_SIZE + compressed.len();
        let mut container = vec![0u8; HEADER_SIZE];
        container[..MAGIC.len()].copy_from_slice(&MAGIC);
        container[8] = 0;
        container[9] = 1;
        write_test_u16(&mut container, 10, u16::try_from(HEADER_SIZE).unwrap());
        write_test_u16(&mut container, 16, 1);
        write_test_u16(&mut container, 18, 1);
        container[20] = 7;
        container[21] = 0;
        write_test_u32(&mut container, 24, TICK_RATE);
        write_test_u64(&mut container, 28, 2_500);
        write_test_u64(&mut container, 100, u64::try_from(index_offset).unwrap());
        write_test_u32(
            &mut container,
            108,
            u32::try_from(CHUNK_HEADER_SIZE + index_payload.len()).unwrap(),
        );
        write_test_u32(&mut container, 112, 2);
        write_test_u32(
            &mut container,
            116,
            u32::try_from(compressed.len().max(index_payload.len())).unwrap(),
        );
        write_test_u32(&mut container, 120, 1);
        write_test_u32(&mut container, 124, 1);
        append_test_chunk(&mut container, b"META", FLAG_CRC | FLAG_DEFLATE, compressed);
        append_test_chunk(&mut container, b"INDX", FLAG_CRC, &index_payload);
        container
    }

    fn append_test_chunk(container: &mut Vec<u8>, chunk_type: &[u8; 4], flags: u32, stored: &[u8]) {
        let offset = container.len();
        container.resize(offset + CHUNK_HEADER_SIZE, 0);
        container[offset..offset + 4].copy_from_slice(chunk_type);
        write_test_u32(container, offset + 4, flags);
        write_test_u32(container, offset + 24, u32::try_from(stored.len()).unwrap());
        write_test_u32(container, offset + 28, crc32(stored));
        container.extend_from_slice(stored);
    }

    fn write_test_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn write_test_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn write_test_u64(bytes: &mut [u8], offset: usize, value: u64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }
}
