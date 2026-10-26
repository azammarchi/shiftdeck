// Engine: ImageMagick (https://imagemagick.org), on macOS, Linux and Windows.
// Reads images in any format it supports (HEIC included, where it was built
// with libheif) and converts PNG to JPEG. Version 7 is `magick`; version 6,
// still common on Linux, is `convert` and `identify`.
const { findProgram, runProgram, isDisabled, ToolError, isWindows } = require('./run');

// Windows has an unrelated convert.exe, so only `magick` counts there.
function programs() {
  if (isDisabled('imagemagick')) return null;
  const magick = findProgram('magick');
  if (magick) return { convert: [magick], identify: [magick, 'identify'] };
  if (isWindows) return null;
  const convert = findProgram('convert');
  const identify = findProgram('identify');
  return convert && identify ? { convert: [convert], identify: [identify] } : null;
}

function run(kind, args, options) {
  const found = programs();
  if (!found) throw new ToolError('noEngine', 'ImageMagick is not installed');
  const [file, ...prefix] = found[kind];
  return runProgram(file, [...prefix, ...args], options);
}

// The first frame of `input`, upright, flattened on white, as 8-bit RGB pixels.
async function pixels(input) {
  const { code, stdout, stderr } = await run('convert', [
    `${input}[0]`, '-auto-orient', '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
    '-colorspace', 'sRGB', '-depth', '8', 'ppm:-',
  ], { binary: true });
  if (code !== 0) throw new ToolError('notImage', `not an image this computer can read: ${stderr.trim()}`);
  return parsePpm(stdout);
}

// Binary PPM: "P6", width, height, max value (comments allowed), then pixels.
function parsePpm(buffer) {
  const fields = [];
  let i = 0;
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(buffer[i]))) i++;
    if (buffer[i] === 0x23) { // '#' comment
      while (buffer[i] !== 0x0a) i++;
      continue;
    }
    const start = i;
    while (!/\s/.test(String.fromCharCode(buffer[i]))) i++;
    fields.push(buffer.toString('latin1', start, i));
  }
  const [magic, width, height, max] = fields;
  if (magic !== 'P6' || max !== '255') throw new ToolError('notImage', 'unexpected image data');
  return { width: Number(width), height: Number(height), data: buffer.subarray(i + 1) };
}

// "TopLeft", "RightTop"... or "Undefined"; and the color space.
async function describe(input) {
  const { code, stdout } = await run('identify', ['-format', '%[orientation] %[colorspace]', `${input}[0]`]);
  if (code !== 0) throw new ToolError('notImage', `not an image: ${input}`);
  const [orientation, colorspace] = stdout.trim().split(/\s+/);
  return { orientation, colorspace };
}

async function toJpeg(input, output, quality = 85) {
  const { code, stderr } = await run('convert', [input, '-quality', String(quality), output]);
  if (code !== 0) throw new ToolError('failed', stderr.trim());
}

// Which of the formats Shiftdeck offers this ImageMagick can write: HEIC and
// WebP depend on how it was built. Asked once per ImageMagick program.
const FORMAT_NAMES = { jpeg: 'JPEG', png: 'PNG', webp: 'WEBP', tiff: 'TIFF', heic: 'HEIC' };
const writableCache = new Map();

async function writableFormats() {
  const found = programs();
  if (!found) return [];
  const key = found.convert.join(' ');
  if (!writableCache.has(key)) {
    writableCache.set(key, run('convert', ['-list', 'format']).then(({ stdout }) => {
      // Lines look like "     WEBP* WEBP      rw+   WebP Image Format".
      const modes = {};
      for (const line of stdout.split('\n')) {
        const match = /^\s*([A-Z0-9-]+)\*?\s+\S+\s+([r-])([w-])([+-])/.exec(line);
        if (match) modes[match[1]] = match[3] === 'w';
      }
      return Object.keys(FORMAT_NAMES).filter((format) => modes[FORMAT_NAMES[format]]);
    }));
  }
  return writableCache.get(key);
}

// Converts one image: turned upright from its EXIF orientation, optionally
// shrunk so its longest side is at most `maxSize` (never enlarged), and
// optionally without metadata. Removing metadata drops EXIF (location,
// camera, date), XMP, IPTC and comments, but keeps the colour profile, so
// colours don't change.
async function convert(input, output, { quality, maxSize, stripMetadata }) {
  const args = [`${input}[0]`, '-auto-orient'];
  if (maxSize) args.push('-resize', `${maxSize}x${maxSize}>`);
  if (stripMetadata) args.push('+profile', '!icc,*', '-set', 'comment', '');
  if (quality) args.push('-quality', String(quality));
  args.push(output);
  const { code, stderr } = await run('convert', args);
  if (code !== 0) {
    if (/no decode delegate|improper image header|not recognized|unable to open image/i.test(stderr)) {
      throw new ToolError('notImage', `not an image this computer can read: ${stderr.trim()}`);
    }
    throw new ToolError('failed', stderr.trim());
  }
}

// Format, size and metadata of an image, as ImageMagick sees it (for tests).
async function identify(input, format) {
  const { code, stdout, stderr } = await run('identify', ['-format', format, `${input}[0]`]);
  if (code !== 0) throw new ToolError('notImage', stderr.trim());
  return stdout;
}

module.exports = { available: () => !!programs(), pixels, describe, toJpeg, writableFormats, convert, identify };
