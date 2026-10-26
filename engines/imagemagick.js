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

module.exports = { available: () => !!programs(), pixels, describe, toJpeg };
