function parseRatio(value) {
  const match = String(value || "").match(/^([0-9]+):([0-9]+)$/);
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
      numerator < 1 || denominator < 1) return null;
  return numerator / denominator;
}

function normalizedRotation(stream) {
  const value = stream.side_data_list
    ?.map((entry) => Number(entry.rotation))
    .find((entry) => Number.isFinite(entry)) ?? 0;
  return ((value % 360) + 360) % 360;
}

export function displayGeometryFromProbe(stream) {
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1) {
    throw new Error("Input has no valid video dimensions");
  }

  const sampleAspectRatio = parseRatio(stream.sample_aspect_ratio) ?? 1;
  const storedAspectRatio = parseRatio(stream.display_aspect_ratio) ??
    (width * sampleAspectRatio / height);
  const rotationDegrees = normalizedRotation(stream);
  let displayAspectRatio;
  if (rotationDegrees === 90 || rotationDegrees === 270) {
    displayAspectRatio = 1 / storedAspectRatio;
  } else if (rotationDegrees === 0 || rotationDegrees === 180) {
    displayAspectRatio = storedAspectRatio;
  } else {
    const radians = rotationDegrees * Math.PI / 180;
    const cosine = Math.abs(Math.cos(radians));
    const sine = Math.abs(Math.sin(radians));
    displayAspectRatio =
      (storedAspectRatio * cosine + sine) /
      (storedAspectRatio * sine + cosine);
  }
  if (!Number.isFinite(displayAspectRatio) || displayAspectRatio <= 0) {
    throw new Error("Input has no valid display aspect ratio");
  }
  return {
    storedWidth: width,
    storedHeight: height,
    rotationDegrees,
    displayAspectRatio
  };
}

export function containAspect(targetWidth, targetHeight, sourceAspectRatio) {
  if (!Number.isSafeInteger(targetWidth) || !Number.isSafeInteger(targetHeight) ||
      targetWidth < 1 || targetHeight < 1) {
    throw new RangeError("Aspect-fit target dimensions must be positive safe integers");
  }
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) {
    throw new RangeError("Source display aspect ratio must be positive");
  }

  let width;
  let height;
  if (sourceAspectRatio >= targetWidth / targetHeight) {
    width = targetWidth;
    height = Math.max(1, Math.min(targetHeight, Math.floor(targetWidth / sourceAspectRatio)));
  } else {
    height = targetHeight;
    width = Math.max(1, Math.min(targetWidth, Math.floor(targetHeight * sourceAspectRatio)));
  }
  return {
    width,
    height,
    x: Math.floor((targetWidth - width) / 2),
    y: Math.floor((targetHeight - height) / 2)
  };
}
