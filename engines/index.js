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
const { writePdf, jpegFrame, textWidth } = require('./pdfwrite');
const { readPng } = require('../lib/png');
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

// Where page numbers and signatures go: how far from the page's edges, in
// points (28 is about 1 cm).
const STAMP_POSITIONS = ['bottom-center', 'bottom-right', 'bottom-left', 'top-center', 'top-right', 'top-left'];
const STAMP_MARGIN = 28;

// x, y (bottom left, in points) of something w × h placed at `position` on a
// page of the given shown size.
function placeStamp(position, [pageW, pageH], w, h, margin = STAMP_MARGIN) {
  const [vertical, horizontal] = position.split('-');
  const x = horizontal === 'left' ? margin : horizontal === 'right' ? pageW - margin - w : (pageW - w) / 2;
  const y = vertical === 'bottom' ? margin : pageH - margin - h;
  return [x, y];
}

// Writes `layer` pages to a PDF next to `output`, lays them over `input` with
// qpdf, and removes the layer file.
async function stamp(input, output, layerPages, placement, outDir) {
  const layer = path.join(outDir, `layer-${path.basename(output)}`);
  await writePdf(layer, layerPages);
  try {
    await qpdf.overlay(input, layer, output, placement, outDir);
  } finally {
    await fsp.rm(layer, { force: true });
  }
}

// The page list "Organize pages" sends: [{ page, turn }], 1-based pages in
// the new order, each turned by 0, 90, 180 or 270 degrees.
function pageList(value, count) {
  if (!Array.isArray(value) || value.length === 0) throw new ToolError('noPages', 'keep at least one page');
  if (value.length > 10000) throw new ToolError('badOption', 'too many pages');
  return value.map((item) => {
    const page = Number(item?.page);
    const turn = Number(item?.turn ?? 0);
    if (!Number.isInteger(page) || page < 1 || page > count) throw new ToolError('badOption', `page ${item?.page} is not in this PDF (1-${count})`);
    if (![0, 90, 180, 270].includes(turn)) throw new ToolError('badOption', `a page can only be turned by 0, 90, 180 or 270 degrees`);
    return [page, turn];
  });
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

  organize: {
    accepts: PDF_TYPES,
    mode: 'each',
    maxFiles: 1,
    // mutool draws the page thumbnails the app shows.
    needs: () => (native() ? [] : missing('qpdf', 'mutool')),
    async run(file, options, outDir) {
      const count = (await unlockedInfo(file.path)).pages.length;
      const pages = pageList(options.pages, count);
      const output = path.join(outDir, `${stem(file.name)}-organized.pdf`);
      if (native()) return pdfkit('organize', [file.path, output, JSON.stringify(pages)]);
      await qpdf.organize(file.path, output, pages, outDir);
      return { outputs: [output] };
    },
  },

  'page-numbers': {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => missing('qpdf'),
    async run(file, options, outDir) {
      const position = option(options, 'position', STAMP_POSITIONS, 'bottom-center');
      const template = typeof options.template === 'string' && options.template.trim() ? options.template.trim() : '{n}';
      if (template.length > 80 || !template.includes('{n}')) throw new ToolError('badOption', 'the text must contain {n}, the page number');
      const start = integer(options, 'start', 0, 100000, 1);
      const size = integer(options, 'size', 6, 48, 11);
      const skipFirst = options.skipFirst === true;
      const { pages } = await unlockedInfo(file.path);
      const total = start + pages.length - 1;
      // One layer page per page, at the size it is shown; the first one is
      // left blank when it shouldn't get a number.
      const layer = pages.map((page, i) => {
        if (skipFirst && i === 0) return { width: page.size[0], height: page.size[1], draw: [] };
        const text = template.replaceAll('{n}', String(start + i)).replaceAll('{total}', String(total));
        // Text sits on its baseline: lift it by its descent (about a fifth
        // of the size) at the bottom, and keep its height inside at the top.
        const [x, y] = placeStamp(position, page.size, textWidth(text, size), size * 0.75);
        return { width: page.size[0], height: page.size[1], draw: [{ text, x, y: position.startsWith('bottom') ? y + size * 0.2 : y, size }] };
      });
      const output = path.join(outDir, `${stem(file.name)}-numbered.pdf`);
      await stamp(file.path, output, layer, {}, outDir);
      return { outputs: [output] };
    },
  },

  sign: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => missing('qpdf'),
    async run(file, options, outDir) {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(typeof options.signature === 'string' ? options.signature : '');
      if (!match) throw new ToolError('noSignature', 'draw a signature first');
      if (match[1].length > 4 * 1024 * 1024) throw new ToolError('badOption', 'the signature image is too large');
      let image;
      try {
        image = readPng(Buffer.from(match[1], 'base64'));
      } catch (err) {
        throw new ToolError('badOption', `the signature image can't be read: ${err.message}`);
      }
      const position = option(options, 'position', STAMP_POSITIONS, 'bottom-right');
      const width = integer(options, 'width', 40, 500, 150);
      const { pages } = await unlockedInfo(file.path);
      const page = options.page === 'last' || options.page === undefined || options.page === '' ? pages.length : integer(options, 'page', 1, pages.length, pages.length);
      const shown = pages[page - 1].size;
      // As wide as asked, but never wider than the page allows.
      const w = Math.min(width, shown[0] - 2 * STAMP_MARGIN);
      const h = (w * image.height) / image.width;
      const [x, y] = placeStamp(position, shown, w, h);
      const output = path.join(outDir, `${stem(file.name)}-signed.pdf`);
      await stamp(file.path, output, [{ width: shown[0], height: shown[1], draw: [{ image, box: [x, y, w, h] }] }], { to: String(page), from: '1' }, outDir);
      return { outputs: [output] };
    },
  },

  watermark: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => missing('qpdf'),
    async run(file, options, outDir) {
      const text = typeof options.text === 'string' ? options.text.trim() : '';
      if (!text) throw new ToolError('noText', 'type the watermark text');
      if (text.length > 60) throw new ToolError('badOption', 'the watermark text can be at most 60 characters');
      const style = option(options, 'style', ['diagonal', 'horizontal'], 'diagonal');
      const opacity = integer(options, 'opacity', 5, 100, 20) / 100;
      const { pages } = await unlockedInfo(file.path);
      const layer = pages.map(({ size: [w, h] }) => {
        // Across the middle of the page as shown: corner to corner when
        // diagonal, sized to cover about three quarters of that line.
        const angle = style === 'diagonal' ? (Math.atan2(h, w) * 180) / Math.PI : 0;
        const span = style === 'diagonal' ? Math.hypot(w, h) * 0.75 : w * 0.75;
        const size = Math.min(160, Math.max(12, span / textWidth(text, 1)));
        const radians = (angle * Math.PI) / 180;
        const half = textWidth(text, size) / 2;
        const lift = size * 0.35; // half the height of capital letters
        const x = w / 2 - half * Math.cos(radians) + lift * Math.sin(radians);
        const y = h / 2 - half * Math.sin(radians) - lift * Math.cos(radians);
        return { width: w, height: h, draw: [{ text, x, y, size, angle, opacity, color: [0.5, 0.5, 0.5] }] };
      });
      const output = path.join(outDir, `${stem(file.name)}-watermarked.pdf`);
      await stamp(file.path, output, layer, {}, outDir);
      return { outputs: [output] };
    },
  },

  compress: {
    accepts: PDF_TYPES,
    mode: 'each',
    needs: () => missing('qpdf'),
    async run(file, options, outDir) {
      const level = option(options, 'level', ['lossless', 'smaller', 'smallest'], 'smaller');
      await unlockedInfo(file.path);
      const output = path.join(outDir, `${stem(file.name)}-compressed.pdf`);
      await qpdf.compress(file.path, output, { images: { lossless: null, smaller: 80, smallest: 55 }[level] }, outDir);
      const [before, after] = await Promise.all([fsp.stat(file.path), fsp.stat(output)]);
      // Some PDFs are already as small as they get: then the original is kept.
      if (after.size >= before.size) {
        await fsp.copyFile(file.path, output);
        return { outputs: [output], warnings: ['notSmaller'] };
      }
      return { outputs: [output], saved: before.size - after.size };
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
  if (tool.maxFiles && files.length > tool.maxFiles) throw new ToolError('tooManyFiles', `${name} works on ${tool.maxFiles} file at a time`);
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
    for (const warning of result.warnings || []) warnings.add(warning);
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

// Small pictures of every page of a PDF, for the app to show: the page's
// size and rotation, and a PNG (pages appear as shown, rotation applied).
const THUMBNAIL_DPI = 40;
async function pageThumbnails(file, outDir) {
  const { pages } = await unlockedInfo(file);
  let images;
  if (native()) images = (await pdfkit('toimages', [file, outDir, 'thumbnail', 'png', THUMBNAIL_DPI])).outputs;
  else {
    const absent = missing('mutool');
    if (absent.length) throw new ToolError('noEngine', 'page thumbnails need mutool: run npm run setup');
    images = await mutool.renderPages(file, outDir, 'thumbnail', THUMBNAIL_DPI);
  }
  return pages.map((page, i) => ({ ...page, image: images[i] }));
}

module.exports = { TOOLS, engines, runTool, info, pageThumbnails, ToolError };
