// The tools the app offers, and which engine does each one. A tool either
// combines all its files into one result ("combine") or works on each file
// separately ("each").
//
// On macOS, Apple's PDFKit does the PDF work with nothing installed. Elsewhere
// (or when PDFKit is switched off) the same tools run on engines that exist on
// macOS, Linux and Windows alike: qpdf, mutool and ImageMagick, which
// `npm run setup` installs. Passwords always prefer qpdf, for AES-256.
const fsp = require('fs/promises');
const path = require('path');
const pdfkitEngine = require('./pdfkit');
const qpdf = require('./qpdf');
const mutool = require('./mutool');
const imagemagick = require('./imagemagick');
const { writePdf, jpegFrame } = require('./pdfwrite');
const { ToolError } = require('./run');

const { pdfkit } = pdfkitEngine;

const PDF_TYPES = ['.pdf'];
const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.heic', '.heif', '.tif', '.tiff', '.gif', '.bmp', '.webp', '.jp2'];
const DPI_RANGE = [36, 600];
// Image formats "Convert images" can write, and the extension for each.
const IMAGE_OUTPUTS = { jpeg: 'jpg', png: 'png', webp: 'webp', tiff: 'tiff', heic: 'heic' };
const LOSSY = ['jpeg', 'webp', 'heic'];
// Page sizes in points (1/72 inch).
const PAGE_SIZES = { a4: [595, 842], letter: [612, 792] };

function engines() {
  return { pdfkit: pdfkitEngine.available(), qpdf: qpdf.available(), mutool: mutool.available(), imagemagick: imagemagick.available() };
}

const native = () => pdfkitEngine.available();

// The engines among `names` that aren't installed.
function missing(...names) {
  const found = engines();
  return names.filter((name) => !found[name]);
}

// Name for the results: the input's name without its extension, made safe.
function stem(name) {
  const base = path.basename(name, path.extname(name)).replace(/[^\p{L}\p{N} ._()-]+/gu, '_').trim();
  return base.slice(0, 80) || 'file';
}

function option(options, key, allowed, fallback) {
  const value = options[key] ?? fallback;
  if (!allowed.includes(value)) throw new ToolError('badOption', `${key} must be one of ${allowed.join(', ')}`);
  return value;
}

// A whole number in [min, max], or `fallback` when the option is left empty.
function integer(options, key, min, max, fallback) {
  const raw = options[key];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new ToolError('badOption', `${key} must be a whole number from ${min} to ${max}`);
  return value;
}

function requirePassword(options) {
  const password = typeof options.password === 'string' ? options.password : '';
  if (!password) throw new ToolError('noPassword', 'no password given');
  return password;
}

function parseRanges(spec, count) {
  return spec.split(',').map((part) => {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    const from = match && Number(match[1]);
    const to = match && Number(match[2] || match[1]);
    if (!match || from < 1 || to < from || to > count) throw new ToolError('badRange', `bad range "${part}" (pages 1-${count})`);
    return [from, to];
  });
}

// Page count, sizes and encryption of a PDF, with whichever engine is there.
function info(file, password) {
  return native() ? pdfkit('info', [file], { password }) : qpdf.info(file, { password });
}

// Fails with "locked" when the PDF needs a password, like PDFKit does.
async function unlockedInfo(file) {
  const result = await info(file);
  if (result.locked) throw new ToolError('locked', `password protected: ${path.basename(file)}`);
  return result;
}

// Where an image goes on its page: with a4/letter the page has that size,
// turned to match the image, and the image is centered, shrunk to fit if
// needed but never enlarged; with "original" the page is the image's own
// size at 72 dpi. The image keeps its full resolution either way.
function placeImage(width, height, pageSize) {
  if (pageSize === 'original') return { width, height, box: [0, 0, width, height] };
  const [short, long] = PAGE_SIZES[pageSize];
  const [pageW, pageH] = width > height ? [long, short] : [short, long];
  const fit = Math.min(1, pageW / width, pageH / height);
  const w = width * fit;
  const h = height * fit;
  return { width: pageW, height: pageH, box: [(pageW - w) / 2, (pageH - h) / 2, w, h] };
}

// An image ready for the PDF writer: JPEGs that are already upright and RGB or
// gray go in untouched; everything else is decoded by ImageMagick.
async function loadImage(file) {
  if (/\.jpe?g$/i.test(file)) {
    const { orientation, colorspace } = await imagemagick.describe(file);
    const jpeg = await fsp.readFile(file);
    const frame = jpegFrame(jpeg);
    if (frame && ['TopLeft', 'Undefined'].includes(orientation) && [1, 3].includes(frame.components) && colorspace !== 'CMYK') {
      return { ...frame, jpeg };
    }
  }
  const { width, height, data } = await imagemagick.pixels(file);
  return { width, height, rgb: data };
}

const TOOLS = {
  merge: {
    accepts: PDF_TYPES,
    mode: 'combine',
    minFiles: 2,
    needs: () => (native() ? [] : missing('qpdf')),
    async run(files, options, outDir) {
      const output = path.join(outDir, `${stem(files[0].name)}-merged.pdf`);
      if (native()) return pdfkit('merge', [output, ...files.map((f) => f.path)]);
      for (const file of files) await unlockedInfo(file.path);
      await qpdf.merge(output, files.map((f) => f.path), outDir);
      return { outputs: [output] };
    },
  },

  split: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => (native() ? [] : missing('qpdf')),
    async run(file, options, outDir) {
      const ranges = typeof options.ranges === 'string' ? options.ranges.trim() : '';
      const prefix = stem(file.name);
      if (native()) return pdfkit('split', [file.path, outDir, prefix, ...(ranges ? [ranges] : [])]);
      const { pages } = await unlockedInfo(file.path);
      const parts = ranges ? parseRanges(ranges, pages.length) : pages.map((_, i) => [i + 1, i + 1]);
      const outputs = [];
      for (const [from, to] of parts) {
        const output = path.join(outDir, from === to ? `${prefix}-page-${from}.pdf` : `${prefix}-pages-${from}-${to}.pdf`);
        await qpdf.extract(file.path, from, to, output, outDir);
        outputs.push(output);
      }
      return { outputs };
    },
  },

  'pdf-to-images': {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => (native() ? [] : missing('qpdf', 'mutool', 'imagemagick')),
    async run(file, options, outDir) {
      const format = option(options, 'format', ['png', 'jpeg'], 'png');
      const dpi = Number(options.dpi ?? 150);
      if (!(dpi >= DPI_RANGE[0] && dpi <= DPI_RANGE[1])) throw new ToolError('badOption', `dpi must be ${DPI_RANGE.join('-')}`);
      if (native()) return pdfkit('toimages', [file.path, outDir, stem(file.name), format, Math.round(dpi)]);
      await unlockedInfo(file.path);
      const pngs = await mutool.renderPages(file.path, outDir, stem(file.name), Math.round(dpi));
      if (format === 'png') return { outputs: pngs };
      const outputs = [];
      for (const png of pngs) {
        const jpg = png.replace(/\.png$/, '.jpg');
        await imagemagick.toJpeg(png, jpg);
        await fsp.rm(png);
        outputs.push(jpg);
      }
      return { outputs };
    },
  },

  'images-to-pdf': {
    accepts: IMAGE_TYPES,
    mode: 'combine',
    needs: () => (native() ? [] : missing('imagemagick')),
    async run(files, options, outDir) {
      const pageSize = option(options, 'pageSize', ['a4', 'letter', 'original'], 'a4');
      const output = path.join(outDir, `${stem(files[0].name)}.pdf`);
      if (native()) return pdfkit('fromimages', [output, pageSize, ...files.map((f) => f.path)]);
      // One image decoded at a time, written straight into the PDF.
      await writePdf(output, (async function* pages() {
        for (const file of files) {
          const image = await loadImage(file.path);
          yield { ...placeImage(image.width, image.height, pageSize), image };
        }
      })());
      return { outputs: [output] };
    },
  },

  'convert-images': {
    accepts: IMAGE_TYPES,
    mode: 'each',
    needs: () => missing('imagemagick'),
    // The formats this computer's ImageMagick can write, for the app to offer.
    async details() {
      return { formats: imagemagick.available() ? await imagemagick.writableFormats() : [] };
    },
    async run(file, options, outDir) {
      const format = option(options, 'format', Object.keys(IMAGE_OUTPUTS), 'jpeg');
      if (!(await imagemagick.writableFormats()).includes(format)) {
        throw new ToolError('formatUnavailable', `this computer's ImageMagick can't write ${format.toUpperCase()}`);
      }
      const quality = LOSSY.includes(format) ? integer(options, 'quality', 1, 100, 85) : null;
      const maxSize = integer(options, 'maxSize', 16, 30000, null);
      const stripMetadata = options.stripMetadata !== false;
      const output = path.join(outDir, `${stem(file.name)}.${IMAGE_OUTPUTS[format]}`);
      await imagemagick.convert(file.path, output, { quality, maxSize, stripMetadata });
      return { outputs: [output] };
    },
  },

  rotate: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => (native() ? [] : missing('qpdf')),
    async run(file, options, outDir) {
      const degrees = option({ degrees: String(options.degrees ?? 90) }, 'degrees', ['90', '180', '270']);
      const output = path.join(outDir, `${stem(file.name)}-rotated.pdf`);
      if (native()) return pdfkit('rotate', [file.path, output, degrees]);
      await unlockedInfo(file.path);
      await qpdf.rotate(file.path, output, degrees, outDir);
      return { outputs: [output] };
    },
  },

  protect: {
    accepts: PDF_TYPES,
    mode: 'each',
    // PDFKit can protect on its own, weakly; anywhere else qpdf is needed.
    needs: () => (qpdf.available() || native() ? [] : ['qpdf']),
    async run(file, options, outDir) {
      const password = requirePassword(options);
      if ((await info(file.path)).encrypted) throw new ToolError('alreadyEncrypted', `${file.name} is already password protected`);
      const output = path.join(outDir, `${stem(file.name)}-protected.pdf`);
      if (qpdf.available()) {
        await qpdf.encrypt(file.path, output, password, outDir);
        return { outputs: [output], encryption: 'AES-256' };
      }
      return pdfkit('encrypt', [file.path, output], { password });
    },
  },

  unlock: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => (qpdf.available() || native() ? [] : ['qpdf']),
    async run(file, options, outDir) {
      const password = requirePassword(options);
      if (!(await info(file.path)).encrypted) throw new ToolError('notEncrypted', `${file.name} is not password protected`);
      const output = path.join(outDir, `${stem(file.name)}-unlocked.pdf`);
      if (qpdf.available()) {
        await qpdf.decrypt(file.path, output, password, outDir);
        return { outputs: [output] };
      }
      return pdfkit('decrypt', [file.path, output], { password });
    },
  },
};

// Runs a tool on files ({ path, name }), writing results into outDir.
// Resolves with { outputs: [path], warnings: [code] }. "each" tools give
// every input its own subfolder, so two inputs with the same name can't
// overwrite each other's results.
async function runTool(name, files, options, outDir) {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw new ToolError('badTool', `unknown tool ${name}`);
  const missing = tool.needs();
  if (missing.length) throw new ToolError('noEngine', `${name} needs ${missing.join(', ')}: run npm run setup`);
  if (files.length < (tool.minFiles || 1)) throw new ToolError('tooFewFiles', `${name} needs at least ${tool.minFiles || 1} files`);
  for (const file of files) {
    if (!tool.accepts.includes(path.extname(file.name).toLowerCase())) {
      throw new ToolError('wrongType', `${file.name} can't be used with ${name}`);
    }
  }

  const warnings = new Set();
  const outputs = [];
  const collect = (result) => {
    outputs.push(...result.outputs);
    if (result.encryption === 'RC4-128') warnings.add('weakEncryption');
  };
  if (tool.mode === 'combine') {
    collect(await tool.run(files, options, outDir));
  } else {
    for (const [i, file] of files.entries()) {
      const dir = files.length > 1 ? path.join(outDir, String(i + 1)) : outDir;
      await fsp.mkdir(dir, { recursive: true });
      collect(await tool.run(file, options, dir));
    }
  }
  return { outputs, warnings: [...warnings] };
}

module.exports = { TOOLS, engines, runTool, info, ToolError };
