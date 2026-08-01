use std::collections::BTreeMap;

pub const SM2_MASK_ROWS: usize = 16;
pub const MAX_SUBTITLE_FRAMES: usize = 1_000_000;
pub const MAX_SUBTITLE_CANONICAL_ENTRIES: usize = 4_194_304;
pub const MAX_AURN_PACKET_COUNT: usize = 65_535;
pub const MAX_AURN_PACKET_BYTES: usize = 1_275;
pub const MAX_AURN_PACKET_DATA_BYTES: usize = crate::MAX_STORED_CHUNK;

const SM2_HEADER_BYTES: usize = 16;
const AURN_HEADER_BYTES: usize = 32;
const AURN_DESCRIPTOR_BYTES: usize = 4;
const AURN_SAMPLE_RATE: u64 = 48_000;
const TICK_RATE: u64 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubtitleLimits {
    pub expected_frames: Option<usize>,
    pub max_frames: usize,
    pub max_canonical_entries: usize,
}

impl Default for SubtitleLimits {
    fn default() -> Self {
        Self {
            expected_frames: None,
            max_frames: MAX_SUBTITLE_FRAMES,
            max_canonical_entries: MAX_SUBTITLE_CANONICAL_ENTRIES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioLimits {
    pub max_packets: usize,
    pub max_packet_data_bytes: usize,
}

impl Default for AudioLimits {
    fn default() -> Self {
        Self {
            max_packets: MAX_AURN_PACKET_COUNT,
            max_packet_data_bytes: MAX_AURN_PACKET_DATA_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleEntry {
    pub cell_index: u32,
    pub foreground: u8,
    pub background: u8,
    pub mask: [u8; SM2_MASK_ROWS],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubtitleSequence {
    pub cell_count: u32,
    pub palette_depth: u16,
    pub frames: Vec<Vec<SubtitleEntry>>,
    pub canonical_entries: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioPacket {
    pub samples: u16,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AudioRun {
    pub timestamp: u64,
    pub duration: u64,
    pub pre_skip: u32,
    pub end_trim: u32,
    pub kept_samples: u32,
    pub decoded_samples: u32,
    pub packet_data_bytes: u32,
    pub packets: Vec<AudioPacket>,
}

pub fn decode_sm2(bytes: &[u8], limits: SubtitleLimits) -> Result<SubtitleSequence, String> {
    if limits.max_frames == 0
        || limits.max_frames > MAX_SUBTITLE_FRAMES
        || limits.max_canonical_entries == 0
        || limits.max_canonical_entries > MAX_SUBTITLE_CANONICAL_ENTRIES
    {
        return Err("SM2 resource limits lie outside the supported range".to_owned());
    }
    if bytes.len() < SM2_HEADER_BYTES || bytes.get(0..4) != Some(b"SM2\0") {
        return Err("Invalid SM2 sequence header".to_owned());
    }
    let cell_count = read_u32(bytes, 4)?;
    let frame_count = read_u32(bytes, 8)?;
    let palette_depth = read_u16(bytes, 12)?;
    if cell_count == 0
        || usize::try_from(cell_count).map_or(true, |count| count > crate::MAX_CELLS)
        || frame_count == 0
        || !(2..=256).contains(&palette_depth)
    {
        return Err("Invalid SM2 sequence counts".to_owned());
    }
    if read_u16(bytes, 14)? != 0 {
        return Err("Invalid SM2 reserved field".to_owned());
    }

    let target_frames = usize::try_from(frame_count)
        .map_err(|_| "SM2 frame count exceeds platform range".to_owned())?;
    if target_frames > limits.max_frames {
        return Err("SM2 frame count exceeds configured limit".to_owned());
    }
    if limits
        .expected_frames
        .is_some_and(|expected| expected != target_frames)
    {
        return Err("SM2 frame count disagrees with chunk duration".to_owned());
    }

    let mut offset = SM2_HEADER_BYTES;
    let mut frames = Vec::with_capacity(target_frames.min(4096));
    let mut current: BTreeMap<u32, SubtitleEntry> = BTreeMap::new();
    let mut canonical_entries = 0usize;

    while frames.len() < target_frames {
        let opcode = *bytes
            .get(offset)
            .ok_or_else(|| "Truncated SM2 command stream".to_owned())?;
        offset += 1;
        match opcode {
            0x00 => {
                if frames.is_empty() {
                    return Err("SM2 repeat precedes the first plane".to_owned());
                }
                let span = usize::try_from(read_varuint(bytes, &mut offset)?)
                    .map_err(|_| "Invalid SM2 repeat span".to_owned())?;
                if span == 0
                    || frames
                        .len()
                        .checked_add(span)
                        .is_none_or(|end| end > target_frames)
                {
                    return Err("Invalid SM2 repeat span".to_owned());
                }
                let plane = current.values().cloned().collect::<Vec<_>>();
                charge_entries(
                    &mut canonical_entries,
                    plane
                        .len()
                        .checked_mul(span)
                        .ok_or_else(|| "SM2 canonical entry count overflow".to_owned())?,
                    limits.max_canonical_entries,
                )?;
                for _ in 0..span {
                    frames.push(plane.clone());
                }
            }
            0x01 => {
                let count = read_varuint(bytes, &mut offset)?;
                if count > cell_count {
                    return Err("SM2 full plane exceeds cell count".to_owned());
                }
                let entries =
                    read_sm2_entries(bytes, &mut offset, count, cell_count, palette_depth)?;
                charge_entries(
                    &mut canonical_entries,
                    entries.len(),
                    limits.max_canonical_entries,
                )?;
                current = entries
                    .iter()
                    .cloned()
                    .map(|entry| (entry.cell_index, entry))
                    .collect();
                frames.push(entries);
            }
            0x02 => {
                if frames.is_empty() {
                    return Err("SM2 delta precedes the first plane".to_owned());
                }
                let removal_count = read_varuint(bytes, &mut offset)?;
                if removal_count > cell_count {
                    return Err("Invalid SM2 removal".to_owned());
                }
                let mut previous = -1i64;
                for _ in 0..removal_count {
                    let delta = read_varuint(bytes, &mut offset)?;
                    if delta == 0 {
                        return Err("SM2 removal made no progress".to_owned());
                    }
                    let cell = previous
                        .checked_add(i64::from(delta))
                        .ok_or_else(|| "Invalid SM2 removal".to_owned())?;
                    let cell = u32::try_from(cell).map_err(|_| "Invalid SM2 removal".to_owned())?;
                    if cell >= cell_count || current.remove(&cell).is_none() {
                        return Err("Invalid SM2 removal".to_owned());
                    }
                    previous = i64::from(cell);
                }
                let upsert_count = read_varuint(bytes, &mut offset)?;
                if upsert_count > cell_count {
                    return Err("SM2 full plane exceeds cell count".to_owned());
                }
                let upserts =
                    read_sm2_entries(bytes, &mut offset, upsert_count, cell_count, palette_depth)?;
                for entry in upserts {
                    current.insert(entry.cell_index, entry);
                }
                charge_entries(
                    &mut canonical_entries,
                    current.len(),
                    limits.max_canonical_entries,
                )?;
                frames.push(current.values().cloned().collect());
            }
            _ => return Err(format!("Unknown SM2 opcode {opcode}")),
        }
    }

    if offset != bytes.len() {
        return Err("Trailing SM2 sequence bytes".to_owned());
    }
    Ok(SubtitleSequence {
        cell_count,
        palette_depth,
        frames,
        canonical_entries,
    })
}

pub fn decode_aurn_payload(
    payload: &[u8],
    timestamp: u64,
    duration: u64,
    limits: AudioLimits,
) -> Result<AudioRun, String> {
    if limits.max_packets == 0
        || limits.max_packets > MAX_AURN_PACKET_COUNT
        || limits.max_packet_data_bytes == 0
        || limits.max_packet_data_bytes > MAX_AURN_PACKET_DATA_BYTES
    {
        return Err("AURN resource limits lie outside the supported range".to_owned());
    }
    if payload.len() < AURN_HEADER_BYTES {
        return Err("Truncated AURN header".to_owned());
    }
    if payload[0] != 1
        || payload[1] != 1
        || read_u16(payload, 2)? != 0
        || read_u32(payload, 4)? != 48_000
    {
        return Err("Unsupported AURN profile".to_owned());
    }
    let pre_skip = read_u32(payload, 8)?;
    let end_trim = read_u32(payload, 12)?;
    let kept_samples = read_u32(payload, 16)?;
    let decoded_samples = read_u32(payload, 20)?;
    let packet_count = usize::try_from(read_u32(payload, 24)?)
        .map_err(|_| "AURN packet count exceeds platform range".to_owned())?;
    let packet_data_bytes = read_u32(payload, 28)?;
    let packet_data_length = usize::try_from(packet_data_bytes)
        .map_err(|_| "AURN payload-length disagreement".to_owned())?;
    if kept_samples == 0
        || packet_count == 0
        || packet_count > limits.max_packets
        || packet_data_length == 0
        || packet_data_length > limits.max_packet_data_bytes
    {
        return Err("Invalid AURN counts".to_owned());
    }
    let descriptor_bytes = packet_count
        .checked_mul(AURN_DESCRIPTOR_BYTES)
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    let packet_start = AURN_HEADER_BYTES
        .checked_add(descriptor_bytes)
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    let expected_length = packet_start
        .checked_add(packet_data_length)
        .ok_or_else(|| "AURN payload-length disagreement".to_owned())?;
    if expected_length != payload.len() {
        return Err("AURN payload-length disagreement".to_owned());
    }

    let mut packets = Vec::with_capacity(packet_count.min(4096));
    let mut descriptor_offset = AURN_HEADER_BYTES;
    let mut packet_offset = packet_start;
    let mut inferred_decoded_samples = 0u32;
    for _ in 0..packet_count {
        let length = usize::from(read_u16(payload, descriptor_offset)?);
        let declared_samples = read_u16(payload, descriptor_offset + 2)?;
        if length == 0 || length > MAX_AURN_PACKET_BYTES {
            return Err("Invalid AURN packet length".to_owned());
        }
        let end = packet_offset
            .checked_add(length)
            .ok_or_else(|| "Invalid AURN packet length".to_owned())?;
        let packet = payload
            .get(packet_offset..end)
            .ok_or_else(|| "Invalid AURN packet length".to_owned())?;
        let inferred_samples = opus_packet_samples(packet)?;
        if declared_samples != inferred_samples {
            return Err("AURN packet duration disagrees with the Opus TOC".to_owned());
        }
        inferred_decoded_samples = inferred_decoded_samples
            .checked_add(u32::from(inferred_samples))
            .ok_or_else(|| "AURN decoded-sample total mismatch".to_owned())?;
        packets.push(AudioPacket {
            samples: inferred_samples,
            bytes: packet.to_vec(),
        });
        descriptor_offset += AURN_DESCRIPTOR_BYTES;
        packet_offset = end;
    }
    if packet_offset != payload.len() || inferred_decoded_samples != decoded_samples {
        return Err("AURN decoded-sample total mismatch".to_owned());
    }
    if pre_skip
        .checked_add(kept_samples)
        .and_then(|value| value.checked_add(end_trim))
        != Some(decoded_samples)
    {
        return Err("AURN trim and kept-sample accounting mismatch".to_owned());
    }
    if duration != samples_to_ticks(kept_samples)? {
        return Err("AURN chunk duration disagrees with kept samples".to_owned());
    }
    ticks_to_samples(timestamp)?;

    Ok(AudioRun {
        timestamp,
        duration,
        pre_skip,
        end_trim,
        kept_samples,
        decoded_samples,
        packet_data_bytes,
        packets,
    })
}

fn charge_entries(total: &mut usize, added: usize, limit: usize) -> Result<(), String> {
    *total = total
        .checked_add(added)
        .ok_or_else(|| "SM2 canonical entry count overflow".to_owned())?;
    if *total > limit {
        return Err("SM2 canonical entry count exceeds configured limit".to_owned());
    }
    Ok(())
}

fn read_sm2_entries(
    bytes: &[u8],
    offset: &mut usize,
    count: u32,
    cell_count: u32,
    palette_depth: u16,
) -> Result<Vec<SubtitleEntry>, String> {
    let count =
        usize::try_from(count).map_err(|_| "SM2 entry count exceeds platform range".to_owned())?;
    let minimum_bytes = count
        .checked_mul(19)
        .ok_or_else(|| "Truncated or out-of-bounds SM2 entry".to_owned())?;
    if bytes.len().saturating_sub(*offset) < minimum_bytes {
        return Err("Truncated or out-of-bounds SM2 entry".to_owned());
    }
    let mut entries = Vec::with_capacity(count.min(4096));
    let mut previous = -1i64;
    for _ in 0..count {
        let delta = read_varuint(bytes, offset)?;
        if delta == 0 {
            return Err("SM2 entry made no progress".to_owned());
        }
        let cell = previous
            .checked_add(i64::from(delta))
            .ok_or_else(|| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        let cell_index =
            u32::try_from(cell).map_err(|_| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        let end = offset
            .checked_add(18)
            .ok_or_else(|| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        if cell_index >= cell_count || end > bytes.len() {
            return Err("Truncated or out-of-bounds SM2 entry".to_owned());
        }
        let foreground = bytes[*offset];
        let background = bytes[*offset + 1];
        if u16::from(foreground) >= palette_depth || u16::from(background) >= palette_depth {
            return Err("SM2 palette index exceeds active depth".to_owned());
        }
        let mask: [u8; SM2_MASK_ROWS] = bytes[*offset + 2..end]
            .try_into()
            .map_err(|_| "Truncated or out-of-bounds SM2 entry".to_owned())?;
        *offset = end;
        entries.push(SubtitleEntry {
            cell_index,
            foreground,
            background,
            mask,
        });
        previous = i64::from(cell_index);
    }
    Ok(entries)
}

fn opus_packet_samples(packet: &[u8]) -> Result<u16, String> {
    let toc = *packet
        .first()
        .ok_or_else(|| "Empty Opus packet".to_owned())?;
    let config = toc >> 3;
    let samples_per_frame = if config < 12 {
        [480u16, 960, 1920, 2880][usize::from(config & 3)]
    } else if config < 16 {
        [480u16, 960][usize::from(config & 1)]
    } else {
        [120u16, 240, 480, 960][usize::from(config & 3)]
    };
    let code = toc & 3;
    let frames = match code {
        0 => 1u16,
        1 | 2 => 2u16,
        _ => u16::from(
            *packet
                .get(1)
                .ok_or_else(|| "Truncated Opus frame-count byte".to_owned())?
                & 0x3f,
        ),
    };
    let total = frames
        .checked_mul(samples_per_frame)
        .ok_or_else(|| "Invalid Opus packet duration".to_owned())?;
    if frames == 0 || total > 5_760 {
        return Err("Invalid Opus packet duration".to_owned());
    }
    Ok(total)
}

fn samples_to_ticks(samples: u32) -> Result<u64, String> {
    let numerator = u64::from(samples).checked_mul(TICK_RATE).ok_or_else(|| {
        "AURN sample count is not exactly representable on the V64 timeline".to_owned()
    })?;
    if numerator % AURN_SAMPLE_RATE != 0 {
        return Err(
            "AURN sample count is not exactly representable on the V64 timeline".to_owned(),
        );
    }
    Ok(numerator / AURN_SAMPLE_RATE)
}

fn ticks_to_samples(ticks: u64) -> Result<u64, String> {
    let numerator = ticks
        .checked_mul(AURN_SAMPLE_RATE)
        .ok_or_else(|| "AURN timestamp is not aligned to a 48 kHz sample boundary".to_owned())?;
    if numerator % TICK_RATE != 0 {
        return Err("AURN timestamp is not aligned to a 48 kHz sample boundary".to_owned());
    }
    Ok(numerator / TICK_RATE)
}

fn read_varuint(bytes: &[u8], offset: &mut usize) -> Result<u32, String> {
    let start = *offset;
    let mut value = 0u32;
    let mut shift = 0u32;
    for index in 0..5usize {
        let byte = *bytes
            .get(*offset)
            .ok_or_else(|| "Truncated SM2 varuint".to_owned())?;
        *offset += 1;
        if index == 4 && byte & 0xf0 != 0 {
            return Err("Oversized SM2 varuint".to_owned());
        }
        value |= u32::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            let canonical = match value {
                0..=0x7f => 1,
                0x80..=0x3fff => 2,
                0x4000..=0x1f_ffff => 3,
                0x20_0000..=0x0fff_ffff => 4,
                _ => 5,
            };
            if *offset - start != canonical {
                return Err("Non-canonical SM2 varuint".to_owned());
            }
            return Ok(value);
        }
        shift += 7;
    }
    Err("SM2 varuint exceeds five bytes".to_owned())
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let value = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "Truncated integer field".to_owned())?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let value = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "Truncated integer field".to_owned())?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one_plane_two_frame_sequence() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"SM2\0");
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u32.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&[0x01, 0x01, 0x01, 0x01, 0x00]);
        bytes.extend_from_slice(&[0xaa; 16]);
        bytes.extend_from_slice(&[0x00, 0x01]);
        bytes
    }

    #[test]
    fn decodes_sm2_full_and_repeat_planes() {
        let sequence = decode_sm2(&one_plane_two_frame_sequence(), SubtitleLimits::default())
            .expect("SM2 should decode");
        assert_eq!(sequence.frames.len(), 2);
        assert_eq!(sequence.frames[0], sequence.frames[1]);
        assert_eq!(sequence.frames[0][0].cell_index, 0);
        assert_eq!(sequence.canonical_entries, 2);
    }

    #[test]
    fn rejects_repeat_expansion_before_allocating_frames() {
        let mut bytes = one_plane_two_frame_sequence();
        bytes[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        bytes.pop();
        bytes.push(0xff);
        bytes.extend_from_slice(&[0xff, 0xff, 0xff, 0x0f]);
        let error = decode_sm2(&bytes, SubtitleLimits::default()).unwrap_err();
        assert_eq!(error, "SM2 frame count exceeds configured limit");
    }

    #[test]
    fn validates_aurn_timing_and_resource_limits() {
        let mut payload = vec![0; 36];
        payload[0] = 1;
        payload[1] = 1;
        payload[4..8].copy_from_slice(&48_000u32.to_le_bytes());
        payload[16..20].copy_from_slice(&480u32.to_le_bytes());
        payload[20..24].copy_from_slice(&480u32.to_le_bytes());
        payload[24..28].copy_from_slice(&1u32.to_le_bytes());
        payload[28..32].copy_from_slice(&1u32.to_le_bytes());
        payload[32..34].copy_from_slice(&1u16.to_le_bytes());
        payload[34..36].copy_from_slice(&480u16.to_le_bytes());
        payload.push(0);
        let run = decode_aurn_payload(&payload, 0, 600, AudioLimits::default())
            .expect("one Opus packet should validate");
        assert_eq!(run.packets.len(), 1);
        assert!(decode_aurn_payload(&payload, 1, 600, AudioLimits::default()).is_err());
    }
}
