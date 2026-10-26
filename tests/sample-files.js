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
  convertImage(file('p2.png'), file('photo.jpg'), 'jpeg');
  convertImage(file('p1.png'), file('photo.heic'), 'heic');
  fs.writeFileSync(file('notes.txt'), 'not a PDF\n');

  const make = async (tool, inputs, options, name) => {
    const out = path.join(DIR, `.${name}`);
    fs.mkdirSync(out, { recursive: true });
    const files = inputs.map((n) => ({ path: file(n), name: n }));
    const { outputs } = await runTool(tool, files, options, out);
    fs.renameSync(outputs[0], file(name));
    fs.rmSync(out, { recursive: true });
  };
  await make('images-to-pdf', ['p1.png', 'p2.png', 'p3.png'], { pageSize: 'a4' }, 'three-pages.pdf');
  await make('images-to-pdf', ['p4.png', 'p5.png'], { pageSize: 'a4' }, 'two-pages.pdf');
  await make('protect', ['two-pages.pdf'], { password: PASSWORD }, 'protected.pdf');
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

module.exports = { makeSampleFiles, sample, hasSample, imageSize, PASSWORD };
