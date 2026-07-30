export const DEFAULT_PLAYBACK_EFFECTS = Object.freeze({
  crtScanlines: true,
  crtScanlineStrength: 0.18,
  crtScanlinePeriod: 2,
  crtScanlinePhase: 1
});

function assertImage(image) {
  if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      image.width < 1 || image.height < 1 || !Buffer.isBuffer(image.rgba) ||
      image.rgba.length !== image.width * image.height * 4) {
    throw new TypeError("Playback effect requires a complete RGBA image");
  }
}

export function normalizePlaybackEffects(input = {}) {
  const effects = {
    ...DEFAULT_PLAYBACK_EFFECTS,
    ...input
  };
  if (typeof effects.crtScanlines !== "boolean") {
    throw new TypeError("crtScanlines must be boolean");
  }
  if (!Number.isFinite(effects.crtScanlineStrength) ||
      effects.crtScanlineStrength < 0 || effects.crtScanlineStrength > 0.5) {
    throw new RangeError("crtScanlineStrength must be between 0 and 0.5");
  }
  if (!Number.isInteger(effects.crtScanlinePeriod) ||
      effects.crtScanlinePeriod < 2 || effects.crtScanlinePeriod > 8) {
    throw new RangeError("crtScanlinePeriod must be an integer from 2 through 8");
  }
  if (!Number.isInteger(effects.crtScanlinePhase) ||
      effects.crtScanlinePhase < 0 || effects.crtScanlinePhase >= effects.crtScanlinePeriod) {
    throw new RangeError("crtScanlinePhase must fall within the scanline period");
  }
  return Object.freeze(effects);
}

export function applyPlaybackEffects(image, input = {}) {
  assertImage(image);
  const effects = normalizePlaybackEffects(input);
  const rgba = Buffer.from(image.rgba);
  if (!effects.crtScanlines || effects.crtScanlineStrength === 0) {
    return { width: image.width, height: image.height, rgba };
  }

  const multiplier = 1 - effects.crtScanlineStrength;
  for (let y = effects.crtScanlinePhase; y < image.height; y += effects.crtScanlinePeriod) {
    const rowStart = y * image.width * 4;
    const rowEnd = rowStart + image.width * 4;
    for (let offset = rowStart; offset < rowEnd; offset += 4) {
      rgba[offset] = Math.round(rgba[offset] * multiplier);
      rgba[offset + 1] = Math.round(rgba[offset + 1] * multiplier);
      rgba[offset + 2] = Math.round(rgba[offset + 2] * multiplier);
    }
  }
  return { width: image.width, height: image.height, rgba };
}

export const PLAYER_SCANLINE_OPTION = Object.freeze({
  key: "crt_scanlines",
  defaultValue: true,
  menuPath: "View/CRT Scanlines",
  persistenceScope: "v64-player"
});

export const VLC_SCANLINE_OPTION = Object.freeze({
  key: "v64-crt-scanlines",
  defaultValue: true,
  persistenceScope: "vlc-module-config"
});
