import { createHash } from "node:crypto";
const WIDTH = 96;
const HEIGHT = 54;

const FONT = Object.freeze({
  " ": [0, 0, 0, 0, 0, 0, 0],
  "$": [14, 21, 20, 14, 5, 21, 14],
  "3": [14, 17, 1, 6, 1, 17, 14],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "A": [14, 17, 17, 31, 17, 17, 17],
  "C": [14, 17, 16, 16, 16, 17, 14],
  "D": [30, 17, 17, 17, 17, 17, 30],
  "E": [31, 16, 16, 30, 16, 16, 31],
  "G": [14, 17, 16, 23, 17, 17, 15],
  "I": [31, 4, 4, 4, 4, 4, 31],
  "M": [17, 27, 21, 21, 17, 17, 17],
  "N": [17, 25, 21, 19, 17, 17, 17],
  "O": [14, 17, 17, 17, 17, 17, 14],
  "P": [30, 17, 17, 30, 16, 16, 16],
  "R": [30, 17, 17, 30, 20, 18, 17],
  "S": [15, 16, 16, 14, 1, 1, 30],
  "T": [31, 4, 4, 4, 4, 4, 4],
  "V": [17, 17, 17, 17, 17, 10, 4]
});

function image(background) {
  return {
    width: WIDTH,
    height: HEIGHT,
    pixels: Array.from({ length: WIDTH * HEIGHT }, () => [...background])
  };
}

function setPixel(target, x, y, color) {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  target.pixels[y * target.width + x] = [...color];
}

function line(target, x0, y0, x1, y1, color) {
  let dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  let dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    setPixel(target, x0, y0, color);
    if (x0 === x1 && y0 === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) { error += dy; x0 += sx; }
    if (doubled <= dx) { error += dx; y0 += sy; }
  }
}

function fillRect(target, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(target, column, row, color);
    }
  }
}

function strokeRect(target, x, y, width, height, color) {
  line(target, x, y, x + width - 1, y, color);
  line(target, x, y + height - 1, x + width - 1, y + height - 1, color);
  line(target, x, y, x, y + height - 1, color);
  line(target, x + width - 1, y, x + width - 1, y + height - 1, color);
}

function fillPolygon(target, points, color) {
  const minimumY = Math.max(0, Math.min(...points.map((point) => point[1])));
  const maximumY = Math.min(target.height - 1, Math.max(...points.map((point) => point[1])));
  for (let y = minimumY; y <= maximumY; y += 1) {
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if (y1 === y2 || y < Math.min(y1, y2) || y >= Math.max(y1, y2)) continue;
      intersections.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      for (let x = Math.ceil(intersections[index]); x <= Math.floor(intersections[index + 1]); x += 1) {
        setPixel(target, x, y, color);
      }
    }
  }
}

function strokePolygon(target, points, color) {
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    line(target, x1, y1, x2, y2, color);
  }
}

function fillEllipse(target, x0, y0, x1, y1, color) {
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  const radiusX = Math.max(0.5, (x1 - x0) / 2);
  const radiusY = Math.max(0.5, (y1 - y0) / 2);
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0); x <= Math.ceil(x1); x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) setPixel(target, x, y, color);
    }
  }
}

function drawText(target, x, y, text, color) {
  let cursor = x;
  for (const character of text.toUpperCase()) {
    const rows = FONT[character] || FONT[" "];
    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        if (rows[row] & (1 << (4 - column))) setPixel(target, cursor + column, y + row, color);
      }
    }
    cursor += 6;
  }
}

function ppm(target) {
  const lines = ["P3", `${target.width} ${target.height}`, "255"];
  for (let y = 0; y < target.height; y += 1) {
    const row = [];
    for (let x = 0; x < target.width; x += 1) {
      row.push(...target.pixels[y * target.width + x]);
    }
    lines.push(row.join(" "));
  }
  return `${lines.join("\n")}\n`;
}

function threeDimensionalPlate() {
  const target = image([5, 12, 34]);
  for (let y = 0; y < HEIGHT; y += 1) {
    const amount = y / (HEIGHT - 1);
    line(target, 0, y, WIDTH - 1, y, [
      Math.round(5 + 8 * amount),
      Math.round(12 + 18 * amount),
      Math.round(34 + 34 * amount)
    ]);
  }
  const horizon = 27;
  for (const y of [31, 35, 40, 46, 53]) line(target, 0, y, WIDTH - 1, y, [0, 92, 96]);
  for (let x = -80; x <= 176; x += 16) line(target, WIDTH / 2, horizon, x, HEIGHT - 1, [16, 32, 72]);
  const front = [[37, 19], [59, 22], [58, 41], [36, 38]];
  const top = [[37, 19], [49, 12], [69, 16], [59, 22]];
  const side = [[59, 22], [69, 16], [67, 35], [58, 41]];
  fillPolygon(target, front, [22, 119, 255]);
  fillPolygon(target, top, [122, 44, 255]);
  fillPolygon(target, side, [0, 214, 217]);
  for (const polygon of [front, top, side]) strokePolygon(target, polygon, [255, 255, 255]);
  fillEllipse(target, 12, 13, 27, 28, [255, 33, 168]);
  fillEllipse(target, 17, 16, 22, 21, [255, 225, 0]);
  fillRect(target, 73, 11, 17, 2, [255, 31, 45]);
  fillRect(target, 76, 15, 16, 2, [255, 122, 0]);
  return target;
}

function monochromePlate() {
  const target = image([18, 18, 18]);
  for (let y = 0; y < HEIGHT; y += 1) {
    const shade = Math.round(22 + 55 * y / (HEIGHT - 1));
    line(target, 0, y, WIDTH - 1, y, [shade, shade, shade]);
  }
  for (let x = 5; x < 92; x += 14) {
    fillRect(target, x, 6, 10, 19, [45, 45, 45]);
    strokeRect(target, x, 6, 10, 19, [175, 175, 175]);
    line(target, x + 4, 6, x + 4, 24, [110, 110, 110]);
  }
  fillPolygon(target, [[0, 34], [95, 28], [95, 53], [0, 53]], [70, 70, 70]);
  line(target, 0, 34, 95, 28, [220, 220, 220]);
  fillEllipse(target, 45, 17, 51, 23, [15, 15, 15]);
  fillPolygon(target, [[43, 23], [53, 23], [56, 40], [40, 40]], [12, 12, 12]);
  line(target, 44, 40, 42, 51, [8, 8, 8]);
  line(target, 45, 40, 43, 51, [8, 8, 8]);
  line(target, 52, 40, 55, 51, [8, 8, 8]);
  line(target, 53, 40, 56, 51, [8, 8, 8]);
  line(target, 74, 9, 74, 39, [215, 215, 215]);
  fillEllipse(target, 69, 5, 79, 13, [235, 235, 235]);
  for (const [x, y] of [[7, 4], [19, 31], [29, 8], [62, 14], [84, 25], [91, 3], [33, 45], [57, 49]]) {
    setPixel(target, x, y, [245, 245, 245]);
  }
  return target;
}

function screenCapturePlate() {
  const target = image([12, 14, 22]);
  fillRect(target, 0, 0, WIDTH, 6, [31, 35, 48]);
  fillRect(target, 0, 6, 20, HEIGHT - 12, [20, 23, 33]);
  fillRect(target, 20, 6, WIDTH - 20, HEIGHT - 12, [9, 12, 18]);
  fillRect(target, 0, HEIGHT - 6, WIDTH, 6, [0, 92, 96]);
  fillRect(target, 21, 6, 25, 5, [32, 32, 72]);
  fillRect(target, 46, 6, 25, 5, [24, 27, 40]);
  drawText(target, 2, 9, "SRC", [178, 178, 188]);
  drawText(target, 2, 18, "CODEC", [178, 178, 188]);
  drawText(target, 2, 27, "TESTS", [178, 178, 188]);
  for (let index = 0; index < 8; index += 1) {
    const y = 13 + index * 3;
    fillRect(target, 24, y, 6, 2, [112, 112, 112]);
    fillRect(target, 31, y, 12 + (index * 5) % 20, 2, [22, 119, 255]);
    fillRect(target, 47 + (index % 3) * 3, y, 12 + (index * 2) % 18, 2,
      index % 2 ? [23, 212, 91] : [255, 122, 0]);
  }
  fillRect(target, 22, 38, 72, 11, [5, 8, 12]);
  strokeRect(target, 22, 38, 72, 11, [46, 54, 72]);
  drawText(target, 24, 39, "$ NPM TEST", [0, 214, 217]);
  drawText(target, 24, 47, "35 PASSING", [23, 212, 91]);
  fillRect(target, 79, 26, 2, 4, [255, 255, 255]);
  return target;
}

const FIXTURES = Object.freeze({
  "synthetic-3d-orbit": threeDimensionalPlate,
  "synthetic-monochrome-film": monochromePlate,
  "synthetic-screen-capture": screenCapturePlate
});

export const GENERATED_RASTER_SOURCE_IDS = Object.freeze(Object.keys(FIXTURES));

export function generatedRasterSourceFromId(id) {
  const build = FIXTURES[id];
  if (!build) throw new RangeError(`Unknown generated raster source ${id}`);
  const bytes = Buffer.from(ppm(build()), "utf8");
  return Object.freeze({
    id,
    format: "image/x-portable-pixmap",
    width: WIDTH,
    height: HEIGHT,
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex")
  });
}

export function generatedRasterSourceCatalog() {
  return GENERATED_RASTER_SOURCE_IDS.map((id) => {
    const source = generatedRasterSourceFromId(id);
    return {
      id: source.id,
      format: source.format,
      width: source.width,
      height: source.height,
      sha256: source.sha256,
      bytes: source.bytes.length
    };
  });
}
