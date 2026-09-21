import { ACTIVITY_SQUARE_SIZE } from "../shared/activity";

// A single high-resolution icon: browsers downscale it for the tab, and it is
// large enough to double as a touch or install icon.
export const FAVICON_SIZE = 512;

const CELL = 60;
const GAP = 10;
const PADDING = 16;
const RADIUS = 12;
const SAMPLES = 4;

const BACKGROUND: Rgb = [244, 240, 231];
// The five shades from styles.css, resolved to plain sRGB. A change to the
// --activity-level-* custom properties belongs here too; a test keeps the two
// lists from drifting apart.
const LEVEL_COLORS: Rgb[] = [
  [230, 224, 211],
  [199, 208, 196],
  [152, 174, 159],
  [96, 134, 116],
  [39, 93, 71],
];

type Rgb = [number, number, number];

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(
  type: string,
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const body = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) {
    body[index] = type.charCodeAt(index);
  }
  body.set(data, 4);

  const result = new Uint8Array(body.length + 8);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(body, 4);
  view.setUint32(result.length - 4, crc32(body));
  return result;
}

async function deflate(
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const compressed = new Response(data).body?.pipeThrough(
    new CompressionStream("deflate"),
  );
  if (!compressed) throw new Error("Could not compress the icon.");
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

// How much of this pixel the rounded square covers, sampled only where the
// corner arcs actually cut into it.
function coverage(x: number, y: number, left: number, top: number): number {
  const right = left + CELL;
  const bottom = top + CELL;
  if (x >= left + RADIUS && x + 1 <= right - RADIUS) return 1;
  if (y >= top + RADIUS && y + 1 <= bottom - RADIUS) return 1;

  let inside = 0;
  for (let sampleX = 0; sampleX < SAMPLES; sampleX += 1) {
    const pointX = x + (sampleX + 0.5) / SAMPLES;
    const distanceX =
      pointX < left + RADIUS
        ? left + RADIUS - pointX
        : Math.max(0, pointX - (right - RADIUS));
    for (let sampleY = 0; sampleY < SAMPLES; sampleY += 1) {
      const pointY = y + (sampleY + 0.5) / SAMPLES;
      const distanceY =
        pointY < top + RADIUS
          ? top + RADIUS - pointY
          : Math.max(0, pointY - (bottom - RADIUS));
      if (distanceX * distanceX + distanceY * distanceY <= RADIUS * RADIUS) {
        inside += 1;
      }
    }
  }
  return inside / (SAMPLES * SAMPLES);
}

function paint(levels: number[][]): Uint8Array<ArrayBuffer> {
  // One filter byte per row, then three bytes per pixel.
  const stride = 1 + FAVICON_SIZE * 3;
  const raw = new Uint8Array(stride * FAVICON_SIZE);
  for (let y = 0; y < FAVICON_SIZE; y += 1) {
    const row = y * stride;
    for (let x = 0; x < FAVICON_SIZE; x += 1) {
      const offset = row + 1 + x * 3;
      raw[offset] = BACKGROUND[0];
      raw[offset + 1] = BACKGROUND[1];
      raw[offset + 2] = BACKGROUND[2];
    }
  }

  levels.forEach((column, columnIndex) => {
    const left = PADDING + columnIndex * (CELL + GAP);
    column.forEach((level, rowIndex) => {
      const top = PADDING + rowIndex * (CELL + GAP);
      const color = LEVEL_COLORS[level] ?? LEVEL_COLORS[0];
      if (!color) return;
      for (let y = top; y < top + CELL; y += 1) {
        for (let x = left; x < left + CELL; x += 1) {
          const alpha = coverage(x, y, left, top);
          if (alpha === 0) continue;
          const offset = y * stride + 1 + x * 3;
          for (let channel = 0; channel < 3; channel += 1) {
            const background = BACKGROUND[channel] ?? 0;
            raw[offset + channel] = Math.round(
              background + ((color[channel] ?? 0) - background) * alpha,
            );
          }
        }
      }
    });
  });

  return raw;
}

export async function renderActivityFavicon(
  levels: number[][],
): Promise<Uint8Array<ArrayBuffer>> {
  if (levels.length !== ACTIVITY_SQUARE_SIZE) {
    throw new Error("The favicon needs one column per day of the week.");
  }

  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, FAVICON_SIZE);
  headerView.setUint32(4, FAVICON_SIZE);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolor RGB

  const parts: Uint8Array<ArrayBuffer>[] = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(paint(levels))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const png = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}
