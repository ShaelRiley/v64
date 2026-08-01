#include "video64/v64.h"

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static int write_bytes(FILE *output, const uint8_t *bytes, size_t length) {
  return fwrite(bytes, 1, length, output) == length;
}

static int write_u16_le(FILE *output, uint16_t value) {
  const uint8_t bytes[2] = {(uint8_t)value, (uint8_t)(value >> 8)};
  return write_bytes(output, bytes, sizeof(bytes));
}

static int write_u32_le(FILE *output, uint32_t value) {
  const uint8_t bytes[4] = {(uint8_t)value, (uint8_t)(value >> 8),
                            (uint8_t)(value >> 16), (uint8_t)(value >> 24)};
  return write_bytes(output, bytes, sizeof(bytes));
}

static int write_u64_le(FILE *output, uint64_t value) {
  uint8_t bytes[8];
  for (uint32_t index = 0; index < 8; index += 1) {
    bytes[index] = (uint8_t)(value >> (index * 8));
  }
  return write_bytes(output, bytes, sizeof(bytes));
}

static void print_decoder_error(uint32_t handle) {
  const uint32_t length = v64_decoder_error_length(handle);
  if (length == V64_U32_ERROR) {
    fputs("unavailable", stderr);
    return;
  }
  for (uint32_t index = 0; index < length; index += 1) {
    const uint32_t byte = v64_decoder_error_byte(handle, index);
    if (byte > UINT8_MAX) {
      fputs("<invalid error byte>", stderr);
      return;
    }
    fputc((int)byte, stderr);
  }
}

static int require_status(uint32_t handle, uint32_t actual,
                          uint32_t expected, const char *operation) {
  if (actual == expected) {
    return 1;
  }
  fprintf(stderr, "%s returned %" PRIu32 "; expected %" PRIu32 ": ",
          operation, actual, expected);
  print_decoder_error(handle);
  fputc('\n', stderr);
  return 0;
}

static int feed_input(FILE *input, uint32_t handle) {
  for (;;) {
    uint8_t bytes[4];
    const size_t count = fread(bytes, 1, sizeof(bytes), input);
    if (count == 0) {
      if (ferror(input)) {
        perror("reading input");
        return 0;
      }
      return 1;
    }
    uint32_t word = 0;
    for (size_t index = 0; index < count; index += 1) {
      word |= (uint32_t)bytes[index] << (index * 8);
    }
    const uint32_t status =
        v64_decoder_push_word_le(handle, word, (uint32_t)count);
    if (!require_status(handle, status, V64_STATUS_OK, "push_word_le")) {
      return 0;
    }
  }
}

static int write_state_stream(FILE *output, uint32_t handle,
                              uint32_t expected_records,
                              uint32_t *decoded_records) {
  static const uint8_t magic[8] = {'V', '6', '4', 'G', 'O', 'L', 'D', '1'};
  if (!write_bytes(output, magic, sizeof(magic)) ||
      !write_u16_le(output, (uint16_t)v64_decoder_columns(handle)) ||
      !write_u16_le(output, (uint16_t)v64_decoder_rows(handle)) ||
      !write_u32_le(output, expected_records)) {
    return 0;
  }

  *decoded_records = 0;
  for (;;) {
    const uint32_t status = v64_decoder_advance(handle);
    if (status == V64_STATUS_DONE) {
      break;
    }
    if (!require_status(handle, status, V64_STATUS_OK, "advance")) {
      return 0;
    }
    const uint64_t timestamp = v64_decoder_frame_timestamp(handle);
    const uint64_t duration = v64_decoder_frame_duration(handle);
    const uint32_t flags = v64_decoder_frame_flags(handle);
    const uint32_t state_length = v64_decoder_state_length(handle);
    if (timestamp == V64_U64_ERROR || duration == V64_U64_ERROR ||
        flags == V64_U32_ERROR || state_length == V64_U32_ERROR) {
      fputs("frame accessor failed\n", stderr);
      return 0;
    }
    if (!write_u64_le(output, timestamp) || !write_u64_le(output, duration) ||
        fputc((flags & 1u) != 0u, output) == EOF ||
        fputc((flags & 2u) != 0u, output) == EOF ||
        !write_u16_le(output, 0) || !write_u32_le(output, state_length)) {
      return 0;
    }
    for (uint32_t index = 0; index < state_length; index += 1) {
      const uint32_t byte = v64_decoder_state_byte(handle, index);
      if (byte > UINT8_MAX || fputc((int)byte, output) == EOF) {
        fputs("state accessor failed\n", stderr);
        return 0;
      }
    }
    if (v64_decoder_state_byte(handle, state_length) != V64_BYTE_ERROR) {
      fputs("one-past state accessor did not return its sentinel\n", stderr);
      return 0;
    }
    *decoded_records += 1;
  }
  return *decoded_records == expected_records;
}

int main(int argc, char **argv) {
  if (argc != 3) {
    fprintf(stderr, "usage: %s INPUT.v64 OUTPUT.bin\n", argv[0]);
    return EXIT_FAILURE;
  }
  if (v64_abi_version() != V64_ABI_VERSION ||
      v64_decoder_api_version() != 1u) {
    fputs("ABI version disagreement\n", stderr);
    return EXIT_FAILURE;
  }

  FILE *input = fopen(argv[1], "rb");
  if (input == NULL) {
    perror("opening input");
    return EXIT_FAILURE;
  }
  const uint32_t handle = v64_decoder_create(64u * 1024u * 1024u,
                                              64u * 1024u * 1024u);
  if (handle == 0 || !feed_input(input, handle) || fclose(input) != 0 ||
      !require_status(handle, v64_decoder_finish(handle), V64_STATUS_OK,
                      "finish")) {
    if (handle != 0) {
      (void)v64_decoder_destroy(handle);
    }
    return EXIT_FAILURE;
  }

  const uint32_t columns = v64_decoder_columns(handle);
  const uint32_t rows = v64_decoder_rows(handle);
  const uint32_t palette_depth = v64_decoder_palette_depth(handle);
  const uint32_t frame_ticks = v64_decoder_frame_ticks(handle);
  const uint64_t duration_ticks = v64_decoder_duration_ticks(handle);
  const uint32_t records = v64_decoder_video_record_count(handle);
  if (columns == V64_U32_ERROR || rows == V64_U32_ERROR ||
      palette_depth == V64_U32_ERROR || frame_ticks == V64_U32_ERROR ||
      duration_ticks == V64_U64_ERROR || records == V64_U32_ERROR) {
    fputs("header accessor failed\n", stderr);
    (void)v64_decoder_destroy(handle);
    return EXIT_FAILURE;
  }

  FILE *output = fopen(argv[2], "wb");
  if (output == NULL) {
    perror("opening output");
    (void)v64_decoder_destroy(handle);
    return EXIT_FAILURE;
  }
  uint32_t decoded_records = 0;
  const int stream_ok =
      write_state_stream(output, handle, records, &decoded_records);
  const int close_ok = fclose(output) == 0;
  const int reset_ok = require_status(handle, v64_decoder_reset(handle),
                                      V64_STATUS_OK, "reset");
  const int destroy_ok = require_status(handle, v64_decoder_destroy(handle),
                                        V64_STATUS_OK, "destroy");
  const int stale_ok = v64_decoder_destroy(handle) == V64_STATUS_INVALID_HANDLE;
  if (!stream_ok || !close_ok || !reset_ok || !destroy_ok || !stale_ok) {
    fputs("C ABI conformance failed\n", stderr);
    return EXIT_FAILURE;
  }

  printf("{\"format\":\"V64-C-ABI-1\",\"valid\":true,"
         "\"abiVersion\":%" PRIu32 ",\"decoderApiVersion\":%" PRIu32
         ",\"columns\":%" PRIu32 ",\"rows\":%" PRIu32
         ",\"paletteDepth\":%" PRIu32 ",\"frameTicks\":%" PRIu32
         ",\"durationTicks\":%" PRIu64 ",\"videoRecords\":%" PRIu32
         ",\"decodedRecords\":%" PRIu32
         ",\"outOfRangeSentinel\":%" PRIu32
         ",\"staleHandleRejected\":true}\n",
         v64_abi_version(), v64_decoder_api_version(), columns, rows,
         palette_depth, frame_ticks, duration_ticks, records, decoded_records,
         V64_BYTE_ERROR);
  return EXIT_SUCCESS;
}
