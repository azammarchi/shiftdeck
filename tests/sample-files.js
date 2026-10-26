// Sample files for the tests, made fresh on any system (nothing is checked
// into the repo): coloured A4-sized pages as PNG, written here in plain Node,
// a landscape image, a JPEG and a HEIC copy where this computer can make them,
// PDFs made from the pages and a password-protected PDF.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { runTool } = require('../engines');
const { findProgram } = require('../engines/run');

// Outside test-results/, which Playwright empties when it starts.
const DIR = path.join(os.tmpdir(), 'shiftdeck-test-samples');
const PASSWORD = 'open sesame';
const COLORS = [[230, 76, 64], [64, 102, 217], [51, 153, 102], [230, 179, 26], [191, 102, 204]];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// An RGB PNG in one colour, with a white band across the top third, so
// which way up a page is shows in any rendering of it.
// A signature-like RGBA PNG, as a browser canvas makes them: a thick dark
// blue diagonal stroke on a transparent background.
function writeSignaturePng(file, width = 300, height = 100) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const onStroke = Math.abs(y - (x * height) / width) < 6;
      if (onStroke) row.set([20, 30, 90, 255], 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

function writePng(file, width, height, [r, g, b]) {
  const plain = Buffer.alloc(1 + width * 3);
  const band = Buffer.alloc(1 + width * 3, 255);
  plain[0] = band[0] = 0; // no filter
  for (let x = 0; x < width; x++) plain.set([r, g, b], 1 + x * 3);
  const rows = Array.from({ length: height }, (_, y) => (y < height / 3 && y > height / 6 ? band : plain));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// An EXIF block like a phone camera writes: the camera model, an orientation
// (6 = turned 90° clockwise, as from a phone held upright) and a GPS position
// (45°N 9°E), as a little-endian TIFF structure.
function exifSegment() {
  const entry = (tag, type, count, value) => {
    const b = Buffer.alloc(12);
    b.writeUInt16LE(tag, 0);
    b.writeUInt16LE(type, 2);
    b.writeUInt32LE(count, 4);
    if (Buffer.isBuffer(value)) value.copy(b, 8);
    else b.writeUInt32LE(value, 8);
    return b;
  };
  const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5;
  // 13 bytes of text plus one of padding: TIFF offsets must be even.
  const makeText = 'ShiftdeckCam\0';
  const make = Buffer.concat([Buffer.from(makeText, 'latin1'), Buffer.alloc(makeText.length % 2)]);
  const rationals = (...pairs) => {
    const b = Buffer.alloc(pairs.length * 8);
    pairs.forEach(([n, d], i) => {
      b.writeUInt32LE(n, i * 8);
      b.writeUInt32LE(d, i * 8 + 4);
    });
    return b;
  };
  // Layout: header (8), IFD0 (3 entries), Make text, GPS IFD (4 entries), coordinates.
  const ifd0At = 8;
  const makeAt = ifd0At + 2 + 3 * 12 + 4;
  const gpsAt = makeAt + make.length;
  const latAt = gpsAt + 2 + 4 * 12 + 4;
  const lonAt = latAt + 24;
  const orientation = Buffer.alloc(4);
  orientation.writeUInt16LE(6, 0);
  const ifd0 = Buffer.concat([
    Buffer.from([3, 0]),
    entry(0x010f, ASCII, makeText.length, makeAt), // Make
    entry(0x0112, SHORT, 1, orientation), // Orientation
    entry(0x8825, LONG, 1, gpsAt), // GPS IFD
    Buffer.alloc(4),
  ]);
  const gps = Buffer.concat([
    Buffer.from([4, 0]),
    entry(0x0001, ASCII, 2, Buffer.from('N\0')), // GPSLatitudeRef
    entry(0x0002, RATIONAL, 3, latAt), // GPSLatitude
    entry(0x0003, ASCII, 2, Buffer.from('E\0')), // GPSLongitudeRef
    entry(0x0004, RATIONAL, 3, lonAt), // GPSLongitude
    Buffer.alloc(4),
  ]);
  const tiff = Buffer.concat([
    Buffer.from([0x49, 0x49, 42, 0, ifd0At, 0, 0, 0]),
    ifd0, make, gps,
    rationals([45, 1], [0, 1], [0, 1]),
    rationals([9, 1], [0, 1], [0, 1]),
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([header, body]);
}

// A copy of a JPEG with exifSegment() right after its start marker, in place
// of any EXIF it had (sips writes its own, and readers disagree on which of
// two EXIF blocks counts).
function addExif(input, output) {
  const jpeg = fs.readFileSync(input);
  const parts = [jpeg.subarray(0, 2), exifSegment()];
  let at = 2;
  // Header segments run until the start of the image data (FFDA).
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] !== 0xda) {
    const end = at + 2 + jpeg.readUInt16BE(at + 2);
    const isExif = jpeg[at + 1] === 0xe1 && jpeg.toString('latin1', at + 4, at + 10) === 'Exif\0\0';
    if (!isExif) parts.push(jpeg.subarray(at, end));
    at = end;
  }
  parts.push(jpeg.subarray(at));
  fs.writeFileSync(output, Buffer.concat(parts));
}

// Converts an image with sips (macOS) or ImageMagick; false if neither can.
function convertImage(input, output, format) {
  try {
    if (process.platform === 'darwin' && findProgram('sips')) {
      execFileSync(findProgram('sips'), ['-s', 'format', format, input, '--out', output], { stdio: 'ignore' });
    } else {
      const magick = findProgram('magick') || (process.platform !== 'win32' && findProgram('convert'));
      if (!magick) return false;
      execFileSync(magick, [input, output], { stdio: 'ignore' });
    }
    return fs.existsSync(output) && fs.statSync(output).size > 0;
  } catch {
    return false;
  }
}

async function makeSampleFiles() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  const file = (name) => path.join(DIR, name);
  COLORS.forEach((color, i) => writePng(file(`p${i + 1}.png`), 1240, 1754, color));
  writePng(file('landscape.png'), 1754, 1240, COLORS[2]);
  writeSignaturePng(file('signature.png'));
  if (convertImage(file('p2.png'), file('photo.jpg'), 'jpeg')) addExif(file('photo.jpg'), file('phone-photo.jpg'));
  convertImage(file('p1.png'), file('photo.heic'), 'heic');
  fs.writeFileSync(file('notes.txt'), 'not a PDF\n');

  const make = async (tool, inputs, options, name) => {
    const out = path.join(DIR, `making-${name}`);
    fs.mkdirSync(out, { recursive: true });
    const files = inputs.map((n) => ({ path: file(n), name: n }));
    const { outputs } = await runTool(tool, files, options, out);
    fs.renameSync(outputs[0], file(name));
    fs.rmSync(out, { recursive: true });
  };
  await make('images-to-pdf', ['p1.png', 'p2.png', 'p3.png'], { pageSize: 'a4' }, 'three-pages.pdf');
  await make('images-to-pdf', ['p4.png', 'p5.png'], { pageSize: 'a4' }, 'two-pages.pdf');
  // Portrait, landscape, portrait: page order shows in the page sizes.
  await make('images-to-pdf', ['p1.png', 'landscape.png', 'p3.png'], { pageSize: 'a4' }, 'mixed.pdf');
  await make('protect', ['two-pages.pdf'], { password: PASSWORD }, 'protected.pdf');
  await writePhotoPdf(file('photo.pdf'));
  return DIR;
}

const sample = (name) => path.join(DIR, name);
const hasSample = (name) => fs.existsSync(sample(name));

// Pixel size of a PNG or JPEG, read from its header.
function imageSize(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.readUInt32BE(0) === 0x89504e47) return { format: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  const frame = require('../engines/pdfwrite').jpegFrame(data);
  if (data[0] === 0xff && data[1] === 0xd8 && frame) return { format: 'jpeg', width: frame.width, height: frame.height };
  throw new Error(`not a PNG or JPEG: ${filePath}`);
}

// How many dark pixels (text, ink) a PNG has in a region given as fractions
// of its size: [left, top, right, bottom], e.g. [0.4, 0.9, 0.6, 1] for the
// middle of the bottom edge. The sample pages' colours are all lighter.
function darkPixels(pngPath, [left, top, right, bottom]) {
  const { width, height, rgb } = require('../lib/png').readPng(fs.readFileSync(pngPath));
  let count = 0;
  for (let y = Math.floor(top * height); y < Math.ceil(bottom * height); y++) {
    for (let x = Math.floor(left * width); x < Math.ceil(right * width); x++) {
      const i = (y * width + x) * 3;
      if (0.3 * rgb[i] + 0.59 * rgb[i + 1] + 0.11 * rgb[i + 2] < 60) count++;
    }
  }
  return count;
}

// How many pixels differ between two renderings of the same page, in a
// region given as fractions of the size (see darkPixels).
function changedPixels(pngA, pngB, [left, top, right, bottom]) {
  const { readPng } = require('../lib/png');
  const a = readPng(fs.readFileSync(pngA));
  const b = readPng(fs.readFileSync(pngB));
  if (a.width !== b.width || a.height !== b.height) throw new Error('the renderings differ in size');
  let count = 0;
  for (let y = Math.floor(top * a.height); y < Math.ceil(bottom * a.height); y++) {
    for (let x = Math.floor(left * a.width); x < Math.ceil(right * a.width); x++) {
      const i = (y * a.width + x) * 3;
      if (Math.abs(a.rgb[i] - b.rgb[i]) + Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) + Math.abs(a.rgb[i + 2] - b.rgb[i + 2]) > 30) count++;
    }
  }
  return count;
}

// A photo-like PDF stored losslessly (smooth gradients with grain), which
// compresses a lot once its picture becomes a JPEG.
async function writePhotoPdf(file) {
  const { writePdf } = require('../engines/pdfwrite');
  const [width, height] = [1200, 900];
  const rgb = Buffer.alloc(width * height * 3);
  let seed = 1;
  const grain = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 32);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgb.set([((x * 255) / width + grain()) & 255, ((y * 255) / height + grain()) & 255, 128 + grain()], (y * width + x) * 3);
    }
  }
  await writePdf(file, [{ width: 600, height: 450, image: { width, height, rgb }, box: [0, 0, 600, 450] }]);
}

const signatureDataUrl = () => `data:image/png;base64,${fs.readFileSync(sample('signature.png')).toString('base64')}`;

module.exports = { makeSampleFiles, sample, hasSample, imageSize, darkPixels, changedPixels, signatureDataUrl, PASSWORD };
