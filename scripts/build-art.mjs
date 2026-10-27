// One-off: turns the monkey photo (pre-shrunk to a 256x64 BMP) into the
// day and night pixel-art PNGs that get embedded in the banner.
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const bmp = readFileSync(`${root}scripts/monkey-source.bmp`);

const dataOffset = bmp.readUInt32LE(10);
const sourceWidth = bmp.readInt32LE(18);
// The meme text sits on the right of the photo; keep only the monkeys.
const offsetX = 18;
const width = 141;
const rawHeight = bmp.readInt32LE(22);
const height = Math.abs(rawHeight);
const topDown = rawHeight < 0;
const rowSize = Math.ceil((sourceWidth * 3) / 4) * 4;

function pixel(x, y) {
  const row = topDown ? y : height - 1 - y;
  const i = dataOffset + row * rowSize + (x + offsetX) * 3;
  return [bmp[i + 2], bmp[i + 1], bmp[i]];
}

const posterize = (v, levels) => {
  const step = 255 / (levels - 1);
  return Math.round(Math.round(Math.min(255, Math.max(0, v)) / step) * step);
};

function saturate([r, g, b], amount) {
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r, g, b].map((c) => grey + (c - grey) * amount);
}

function day([r, g, b]) {
  return saturate([r * 1.05, g * 1.02, b], 1.25).map((c) => posterize(c, 7));
}

// Moonlit blue everywhere, warm desk-lamp glow from the top right.
const lamp = { x: width * 0.72, y: height * 0.15 };
function night([r, g, b], x, y) {
  const d = Math.hypot(x - lamp.x, (y - lamp.y) * 1.4) / width;
  const glow = Math.max(0, 1 - d * 1.6) ** 1.1;
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  const moon = [r * 0.38 + grey * 0.08, g * 0.42 + grey * 0.1 + 6, b * 0.5 + grey * 0.22 + 30];
  const warm = [r * 1.15 + 20, g * 0.98 + 6, b * 0.7];
  return moon.map((c, i) => posterize(c + (warm[i] - c) * glow, 8));
}

function png(transform) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = transform(pixel(x, y), x, y);
      const i = y * (width * 3 + 1) + 1 + x * 3;
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(`${root}assets/monkey-day.png`, png(day));
writeFileSync(`${root}assets/monkey-night.png`, png(night));
console.log(`wrote ${width}x${height} day + night pixel art`);
