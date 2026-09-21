import { expect } from "vitest";

export interface DecodedPng {
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number];
}

// Just enough of a PNG reader to check what the favicon renderer drew.
export async function decodePng(
  png: Uint8Array<ArrayBuffer>,
): Promise<DecodedPng> {
  expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);

  let offset = 8;
  let width = 0;
  let height = 0;
  const parts: Uint8Array[] = [];
  while (offset < png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.slice(offset + 4, offset + 8));
    const body = png.slice(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(
        body.buffer,
        body.byteOffset,
        body.byteLength,
      );
      width = header.getUint32(0);
      height = header.getUint32(4);
      expect(body[8]).toBe(8);
      expect(body[9]).toBe(2);
    }
    if (type === "IDAT") parts.push(body);
    offset += 12 + length;
  }

  const compressed = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let written = 0;
  for (const part of parts) {
    compressed.set(part, written);
    written += part.length;
  }
  const stream = new Response(compressed).body?.pipeThrough(
    new DecompressionStream("deflate"),
  );
  if (!stream) throw new Error("The PNG carried no image data.");
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());

  const stride = 1 + width * 3;
  expect(raw.length).toBe(stride * height);
  return {
    width,
    height,
    pixel: (x, y) => {
      // Every row is written unfiltered, so its bytes are the pixels.
      expect(raw[y * stride]).toBe(0);
      const start = y * stride + 1 + x * 3;
      return [raw[start] ?? -1, raw[start + 1] ?? -1, raw[start + 2] ?? -1];
    },
  };
}

// The middle of a cell, which the rounded corners never touch.
export function faviconCellCenter(
  column: number,
  row: number,
): [number, number] {
  const step = 70;
  return [16 + column * step + 30, 16 + row * step + 30];
}
