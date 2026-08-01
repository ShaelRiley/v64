#ifndef VIDEO64_V64_H
#define VIDEO64_V64_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define V64_ABI_VERSION 1u

#define V64_STATUS_OK 0u
#define V64_STATUS_DONE 1u
#define V64_STATUS_INVALID_ARGUMENT 2u
#define V64_STATUS_LIMIT 3u
#define V64_STATUS_PARSE_ERROR 4u
#define V64_STATUS_DECODE_ERROR 5u
#define V64_STATUS_INVALID_STATE 6u
#define V64_STATUS_INVALID_HANDLE 7u
#define V64_STATUS_PANIC 255u

#define V64_BYTE_ERROR 256u
#define V64_U32_ERROR UINT32_MAX
#define V64_U64_ERROR UINT64_MAX
#define V64_MAX_SESSIONS 16u
#define V64_MAX_INPUT_BYTES 1073741824u

uint32_t v64_abi_version(void);
uint32_t v64_decoder_api_version(void);

uint32_t v64_decoder_create(uint32_t max_input_bytes,
                            uint32_t max_decoded_bytes);
uint32_t v64_decoder_reset(uint32_t handle);
uint32_t v64_decoder_destroy(uint32_t handle);

uint32_t v64_decoder_push_byte(uint32_t handle, uint32_t byte);
uint32_t v64_decoder_push_word_le(uint32_t handle, uint32_t word,
                                  uint32_t byte_count);
uint32_t v64_decoder_finish(uint32_t handle);
uint32_t v64_decoder_advance(uint32_t handle);

uint32_t v64_decoder_columns(uint32_t handle);
uint32_t v64_decoder_rows(uint32_t handle);
uint32_t v64_decoder_palette_depth(uint32_t handle);
uint32_t v64_decoder_frame_ticks(uint32_t handle);
uint64_t v64_decoder_duration_ticks(uint32_t handle);
uint32_t v64_decoder_video_record_count(uint32_t handle);

uint64_t v64_decoder_frame_timestamp(uint32_t handle);
uint64_t v64_decoder_frame_duration(uint32_t handle);
uint32_t v64_decoder_frame_flags(uint32_t handle);
uint32_t v64_decoder_state_length(uint32_t handle);
uint32_t v64_decoder_state_byte(uint32_t handle, uint32_t index);

uint32_t v64_decoder_error_length(uint32_t handle);
uint32_t v64_decoder_error_byte(uint32_t handle, uint32_t index);

#ifdef __cplusplus
}
#endif

#endif
