use crate::frame::apply_frame_commands;
use crate::{Header, ParseOptions, ResourceLimits, Result, V64File};

pub const DECODER_API_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecoderConfig {
    pub parse_options: ParseOptions,
    pub resource_limits: ResourceLimits,
}

impl Default for DecoderConfig {
    fn default() -> Self {
        Self {
            parse_options: ParseOptions::default(),
            resource_limits: ResourceLimits::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameInfo {
    pub timestamp: u64,
    pub duration: u64,
    pub keyframe: bool,
    pub repeat: bool,
}

#[derive(Debug)]
pub struct Decoder {
    file: V64File,
    next_chunk: usize,
    expected_timestamp: u64,
    state: Option<Vec<u8>>,
    current: Option<FrameInfo>,
    saw_video: bool,
    finished: bool,
}

impl Decoder {
    pub fn from_bytes(input: &[u8]) -> Result<Self> {
        Self::from_bytes_with_config(input, DecoderConfig::default())
    }

    pub fn from_bytes_with_config(input: &[u8], config: DecoderConfig) -> Result<Self> {
        let file =
            crate::parse_with_resource_limits(input, config.parse_options, config.resource_limits)?;
        Ok(Self::from_file(file))
    }

    fn from_file(file: V64File) -> Self {
        Self {
            file,
            next_chunk: 0,
            expected_timestamp: 0,
            state: None,
            current: None,
            saw_video: false,
            finished: false,
        }
    }

    pub fn header(&self) -> &Header {
        &self.file.header
    }

    pub fn file(&self) -> &V64File {
        &self.file
    }

    pub fn video_record_count(&self) -> u32 {
        u32::try_from(
            self.file
                .chunks
                .iter()
                .filter(|chunk| chunk.chunk_type == "VFRM" || chunk.chunk_type == "RPTF")
                .count(),
        )
        .expect("container chunk count is already limited to uint32")
    }

    pub fn current_frame(&self) -> Option<FrameInfo> {
        self.current
    }

    pub fn current_state(&self) -> Option<&[u8]> {
        self.current.and(self.state.as_deref())
    }

    pub fn reset_video(&mut self) {
        self.next_chunk = 0;
        self.expected_timestamp = 0;
        self.state = None;
        self.current = None;
        self.saw_video = false;
        self.finished = false;
    }

    pub fn advance(&mut self) -> Result<Option<FrameInfo>> {
        if self.finished {
            return Ok(None);
        }

        let mut candidate = self.next_chunk;
        while candidate < self.file.chunks.len()
            && self.file.chunks[candidate].chunk_type != "VFRM"
            && self.file.chunks[candidate].chunk_type != "RPTF"
        {
            candidate += 1;
        }

        if candidate == self.file.chunks.len() {
            if !self.saw_video {
                return Err(crate::Error::new("File contains no video timeline"));
            }
            if self.expected_timestamp > self.file.header.duration_ticks {
                return Err(crate::Error::new(
                    "Video timeline exceeds declared duration",
                ));
            }
            self.current = None;
            self.finished = true;
            return Ok(None);
        }

        let chunk = &self.file.chunks[candidate];
        if chunk.timestamp != self.expected_timestamp {
            return Err(crate::Error::new(format!(
                "Discontinuous video timeline at {}; expected {}",
                chunk.timestamp, self.expected_timestamp
            )));
        }
        let frame_ticks = u64::from(self.file.header.cadence.frame_ticks);
        if chunk.duration == 0 || chunk.duration % frame_ticks != 0 {
            return Err(crate::Error::new(format!(
                "{} duration is not a whole nominal frame span",
                chunk.chunk_type
            )));
        }
        let next_timestamp = self
            .expected_timestamp
            .checked_add(chunk.duration)
            .ok_or_else(|| crate::Error::new("Video timeline duration overflow"))?;

        let info = if chunk.chunk_type == "VFRM" {
            let kind = chunk
                .payload
                .first()
                .copied()
                .ok_or_else(|| crate::Error::new("Invalid VFRM kind"))?;
            if kind > 1 {
                return Err(crate::Error::new("Invalid VFRM kind"));
            }
            let keyframe = kind == 0;
            let decoded = apply_frame_commands(
                &chunk.payload[1..],
                self.state.as_deref(),
                usize::from(self.file.header.columns),
                usize::from(self.file.header.rows),
                usize::from(self.file.header.palette_depth),
                keyframe,
            )
            .map_err(crate::Error::new)?;
            self.state = Some(decoded);
            FrameInfo {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe,
                repeat: false,
            }
        } else {
            if !chunk.payload.is_empty() {
                return Err(crate::Error::new("RPTF payload must be empty"));
            }
            if self.state.is_none() {
                return Err(crate::Error::new("Repeat frame precedes first video frame"));
            }
            FrameInfo {
                timestamp: chunk.timestamp,
                duration: chunk.duration,
                keyframe: false,
                repeat: true,
            }
        };

        self.expected_timestamp = next_timestamp;
        self.next_chunk = candidate + 1;
        self.current = Some(info);
        self.saw_video = true;
        Ok(Some(info))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROCEDURAL: &[u8] = include_bytes!("../../../tests/golden/procedural.v64");

    #[test]
    fn stable_decoder_streams_the_complete_golden_timeline() {
        let mut decoder = Decoder::from_bytes(PROCEDURAL).expect("golden file should open");
        assert_eq!(DECODER_API_VERSION, 1);
        assert_eq!(decoder.header().columns, 40);
        assert_eq!(decoder.header().rows, 11);
        let expected_state = 40 * 11 * 3;
        let records = decoder.video_record_count();
        let mut decoded = 0u32;
        while let Some(info) = decoder.advance().expect("timeline should decode") {
            assert_eq!(
                decoder
                    .current_state()
                    .expect("frame should expose state")
                    .len(),
                expected_state
            );
            decoded += 1;
            assert!(!info.repeat, "the procedural fixture contains no RPTF");
        }
        assert_eq!(decoded, records);
        assert!(decoder.advance().expect("EOF should be stable").is_none());
    }

    #[test]
    fn reset_replays_the_identical_first_frame() {
        let mut decoder = Decoder::from_bytes(PROCEDURAL).expect("golden file should open");
        let first_info = decoder
            .advance()
            .expect("first advance should succeed")
            .expect("first frame should exist");
        let first_state = decoder
            .current_state()
            .expect("first state should exist")
            .to_vec();
        decoder.reset_video();
        assert_eq!(
            decoder.advance().expect("replay should succeed"),
            Some(first_info)
        );
        assert_eq!(
            decoder
                .current_state()
                .expect("replayed state should exist"),
            first_state
        );
    }

    #[test]
    fn repeat_records_reuse_the_prior_committed_state() {
        let mut file = crate::parse(PROCEDURAL).expect("golden file should parse");
        let first_video = file
            .chunks
            .iter()
            .position(|chunk| chunk.chunk_type == "VFRM")
            .expect("golden file should contain video");
        let mut repeat = file.chunks[first_video].clone();
        repeat.chunk_type = "RPTF".to_owned();
        repeat.timestamp += repeat.duration;
        repeat.payload.clear();
        let repeat_duration = repeat.duration;
        for chunk in &mut file.chunks[first_video + 1..] {
            if chunk.chunk_type == "VFRM" || chunk.chunk_type == "RPTF" {
                chunk.timestamp += repeat_duration;
            }
        }
        file.header.duration_ticks += repeat_duration;
        file.chunks.insert(first_video + 1, repeat);

        let mut decoder = Decoder::from_file(file);
        let first = decoder
            .advance()
            .expect("first frame should decode")
            .expect("first frame should exist");
        assert!(!first.repeat);
        let state_pointer = decoder
            .current_state()
            .expect("first frame should expose state")
            .as_ptr();
        let repeated = decoder
            .advance()
            .expect("repeat should decode")
            .expect("repeat should exist");
        assert!(repeated.repeat);
        assert_eq!(
            decoder
                .current_state()
                .expect("repeat should expose state")
                .as_ptr(),
            state_pointer,
            "repeat records must not clone the prior state"
        );
    }
}
