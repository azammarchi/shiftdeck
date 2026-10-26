// Reads 8-bit PNG images (RGB or RGBA, not interlaced), the kind a browser's
// canvas produces, into separate colour and alpha planes. Plain Node: zlib
// does the decompression, this undoes PNG's row filters.
const zlib = require('zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// { width, height, rgb: Buffer, alpha: Buffer | null }
function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG image');
  let at = 8;
  let header = null;
  const data = [];
  while (at + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colorType: body[9], interlace: body[12] };
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) throw new Error('PNG without a header');
  const { width, height, depth, colorType, interlace } = header;
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error('only 8-bit RGB or RGBA PNGs, not interlaced, are supported');
  if (!width || !height || width * height > 50_000_000) throw new Error('PNG too large');

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(data));
  if (raw.length < (stride + 1) * height) throw new Error('PNG data is cut short');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[out + x - channels] : 0;
      const up = y > 0 ? pixels[out - stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[out - stride + x - channels] : 0;
      const value = row[x];
      pixels[out + x] = filter === 0 ? value
        : filter === 1 ? value + left
        : filter === 2 ? value + up
        : filter === 3 ? value + ((left + up) >> 1)
        : filter === 4 ? value + paeth(left, up, upLeft)
        : (() => { throw new Error(`unknown PNG filter ${filter}`); })();
    }
  }

  const rgb = Buffer.alloc(width * height * 3);
  const alpha = channels === 4 ? Buffer.alloc(width * height) : null;
  for (let i = 0; i < width * height; i++) {
    pixels.copy(rgb, i * 3, i * channels, i * channels + 3);
    if (alpha) alpha[i] = pixels[i * 4 + 3];
  }
  return { width, height, rgb, alpha };
}

module.exports = { readPng };
