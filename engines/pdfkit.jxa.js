// PDF tools built only on what ships with macOS: JavaScript for Automation
// (osascript -l JavaScript) bridging to Apple's PDFKit and AppKit. Nothing to
// install. engines/pdfkit.js runs it; it prints a single line of JSON:
// { ok: true, ...result } or { ok: false, code, error }.
//
//   info       <in.pdf>
//   merge      <out.pdf> <in.pdf>...
//   split      <in.pdf> <outDir> <prefix> [ranges, e.g. "1-3,4,5-7"]
//   toimages   <in.pdf> <outDir> <prefix> <png|jpeg> <dpi>
//   fromimages <out.pdf> <a4|letter|original> <image>...
//   rotate     <in.pdf> <out.pdf> <90|180|270>
//   organize   <in.pdf> <out.pdf> <JSON [[page, turn], ...]>   (1-based pages, in the new order)
//   text       <in.pdf>                                       (the text of each page)
//   encrypt    <in.pdf> <out.pdf>
//   decrypt    <in.pdf> <out.pdf>
//
// Passwords come from the SHIFTDECK_PASSWORD environment variable, never from
// the command line, where any user on the Mac could read them with `ps`.
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('PDFKit');

// JXA doesn't bridge most framework constants, so their values are spelled out.
const MEDIA_BOX = 0; // kPDFDisplayBoxMediaBox
const FILE_TYPES = { png: 4, jpeg: 3 }; // NSBitmapImageFileType
const USER_PASSWORD = 'kCGPDFContextUserPassword'; // PDFDocumentUserPasswordOption
const OWNER_PASSWORD = 'kCGPDFContextOwnerPassword'; // PDFDocumentOwnerPasswordOption
const JPEG_QUALITY = 'NSImageCompressionFactor';
// Page sizes in points (1/72 inch).
const PAGE_SIZES = { a4: [595, 842], letter: [612, 792] };

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function password() {
  const value = $.NSProcessInfo.processInfo.environment.objectForKey('SHIFTDECK_PASSWORD');
  return value.isNil() ? '' : value.js;
}

// JXA hands back NSUInteger properties as strings.
const pageCount = (doc) => Number(doc.pageCount);

function open(path) {
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(path));
  if (doc.isNil()) throw new ToolError('notPdf', `not a PDF: ${path}`);
  if (doc.isLocked) {
    const given = password();
    if (!given) throw new ToolError('locked', `password protected: ${path}`);
    if (!doc.unlockWithPassword(given)) throw new ToolError('wrongPassword', `wrong password: ${path}`);
  }
  return doc;
}

function save(doc, path, options) {
  const ok = options ? doc.writeToFileWithOptions(path, options) : doc.writeToFile(path);
  if (!ok) throw new ToolError('writeFailed', `cannot write ${path}`);
  return path;
}

// A new document made of copies of the given pages (0-based) of `doc`.
// Copying also drops any encryption the source had.
function copyPages(doc, indexes) {
  const out = $.PDFDocument.alloc.init;
  for (const i of indexes) out.insertPageAtIndex(doc.pageAtIndex(i).copy, pageCount(out));
  return out;
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function parseRanges(spec, count) {
  return spec.split(',').map((part) => {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    const from = match && Number(match[1]);
    const to = match && Number(match[2] || match[1]);
    if (!match || from < 1 || to < from || to > count) throw new ToolError('badRange', `bad range "${part}" (pages 1-${count})`);
    return [from, to];
  });
}

// Size of the page as it is shown, so with its /Rotate applied.
function shownSize(page) {
  const { width, height } = page.boundsForBox(MEDIA_BOX).size;
  return page.rotation % 180 === 0 ? [width, height] : [height, width];
}

const commands = {
  info(input) {
    const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(input));
    if (doc.isNil()) throw new ToolError('notPdf', `not a PDF: ${input}`);
    const encrypted = !!doc.isEncrypted;
    const locked = !!doc.isLocked && !(password() && doc.unlockWithPassword(password()));
    if (locked) return { encrypted, locked };
    const pages = range(0, pageCount(doc) - 1).map((i) => {
      const page = doc.pageAtIndex(i);
      return { size: shownSize(page).map(Math.round), rotation: Number(page.rotation) };
    });
    return { encrypted, locked, pages };
  },

  merge(output, ...inputs) {
    const out = $.PDFDocument.alloc.init;
    for (const input of inputs) {
      const doc = open(input);
      for (let i = 0; i < pageCount(doc); i++) out.insertPageAtIndex(doc.pageAtIndex(i).copy, pageCount(out));
    }
    save(out, output);
    return { outputs: [output] };
  },

  split(input, outDir, prefix, spec) {
    const doc = open(input);
    const count = pageCount(doc);
    const ranges = spec ? parseRanges(spec, count) : range(1, count).map((p) => [p, p]);
    const outputs = ranges.map(([from, to]) => {
      const name = from === to ? `${prefix}-page-${from}.pdf` : `${prefix}-pages-${from}-${to}.pdf`;
      return save(copyPages(doc, range(from - 1, to - 1)), `${outDir}/${name}`);
    });
    return { outputs };
  },

  toimages(input, outDir, prefix, format, dpi) {
    if (!FILE_TYPES[format]) throw new ToolError('badOption', `unknown image format ${format}`);
    const doc = open(input);
    const scale = Number(dpi) / 72;
    const outputs = [];
    for (let i = 0; i < pageCount(doc); i++) {
      const page = doc.pageAtIndex(i);
      // PDFKit draws the page with its rotation applied, so the canvas takes
      // the shown size: a page turned by 90° comes out landscape.
      const [w, h] = shownSize(page).map((side) => Math.max(1, Math.round(side * scale)));
      const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
        null, w, h, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
      $.NSGraphicsContext.saveGraphicsState;
      const context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
      $.NSGraphicsContext.setCurrentContext(context);
      $.NSColor.whiteColor.setFill;
      $.NSRectFill($.NSMakeRect(0, 0, w, h));
      const transform = $.NSAffineTransform.transform;
      transform.scaleBy(scale);
      transform.concat;
      page.drawWithBoxToContext(MEDIA_BOX, context.CGContext);
      $.NSGraphicsContext.restoreGraphicsState;
      const properties = $.NSMutableDictionary.dictionary;
      if (format === 'jpeg') properties.setObjectForKey(0.85, JPEG_QUALITY);
      const path = `${outDir}/${prefix}-page-${i + 1}.${format === 'jpeg' ? 'jpg' : 'png'}`;
      if (!rep.representationUsingTypeProperties(FILE_TYPES[format], properties).writeToFileAtomically(path, true)) {
        throw new ToolError('writeFailed', `cannot write ${path}`);
      }
      outputs.push(path);
    }
    return { outputs };
  },

  // Each image becomes a page. With a4/letter the page has that size, turned to
  // match the image, and the image is centered on it, shrunk to fit if needed
  // but never enlarged. With "original" the page is the image's own size at 72
  // dpi. The image keeps its full resolution either way.
  fromimages(output, pageSize, ...images) {
    if (pageSize !== 'original' && !PAGE_SIZES[pageSize]) throw new ToolError('badOption', `unknown page size ${pageSize}`);
    const out = $.PDFDocument.alloc.init;
    for (const path of images) {
      const image = $.NSImage.alloc.initWithContentsOfFile(path);
      if (image.isNil() || !image.isValid) throw new ToolError('notImage', `not an image: ${path}`);
      // Pixel size at 72 dpi, so photos with a high dpi in their metadata
      // aren't treated as tiny.
      const rep = image.representations.objectAtIndex(0);
      let w = Number(rep.pixelsWide) || image.size.width;
      let h = Number(rep.pixelsHigh) || image.size.height;
      let box = null;
      if (pageSize !== 'original') {
        const [short, long] = PAGE_SIZES[pageSize];
        const [pageW, pageH] = w > h ? [long, short] : [short, long];
        const fit = Math.min(1, pageW / w, pageH / h);
        w *= fit;
        h *= fit;
        // A media box larger than the image, starting below and left of it,
        // leaves equal margins all around; PDFKit moves it back to 0,0 on save.
        box = $.NSMakeRect(-(pageW - w) / 2, -(pageH - h) / 2, pageW, pageH);
      }
      image.setSize($.NSMakeSize(w, h));
      const page = $.PDFPage.alloc.initWithImage(image);
      if (box) page.setBoundsForBox(box, MEDIA_BOX);
      out.insertPageAtIndex(page, pageCount(out));
    }
    save(out, output);
    return { outputs: [output] };
  },

  text(input) {
    const doc = open(input);
    const pages = range(0, pageCount(doc) - 1).map((i) => {
      const text = doc.pageAtIndex(i).string;
      return text.isNil() ? '' : text.js;
    });
    return { pages };
  },

  // A new PDF from the pages listed, in that order, each turned by its own
  // amount on top of its rotation. Pages not listed are left out.
  organize(input, output, spec) {
    const doc = open(input);
    const count = pageCount(doc);
    let pages;
    try {
      pages = JSON.parse(spec);
    } catch {
      throw new ToolError('badOption', 'pages must be JSON');
    }
    const out = $.PDFDocument.alloc.init;
    for (const [page, turn] of pages) {
      if (!(page >= 1 && page <= count) || ![0, 90, 180, 270].includes(turn)) throw new ToolError('badOption', `bad page ${page} or turn ${turn}`);
      const copy = doc.pageAtIndex(page - 1).copy;
      copy.rotation = (Number(copy.rotation) + turn) % 360;
      out.insertPageAtIndex(copy, pageCount(out));
    }
    save(out, output);
    return { outputs: [output] };
  },

  rotate(input, output, degrees) {
    const turn = Number(degrees);
    if (![90, 180, 270].includes(turn)) throw new ToolError('badOption', `rotation must be 90, 180 or 270, not ${degrees}`);
    const doc = open(input);
    const out = copyPages(doc, range(0, pageCount(doc) - 1));
    for (let i = 0; i < pageCount(out); i++) {
      const page = out.pageAtIndex(i);
      page.rotation = (Number(page.rotation) + turn) % 360;
    }
    save(out, output);
    return { outputs: [output] };
  },

  // Fallback used only when qpdf isn't installed: PDFKit can only write RC4
  // 128-bit encryption (asking for more silently gives RC4 40-bit), which is
  // weak by today's standards. The result says so, and the app tells the user.
  encrypt(input, output) {
    const secret = password();
    if (!secret) throw new ToolError('noPassword', 'no password given');
    const doc = open(input);
    if (doc.isEncrypted) throw new ToolError('alreadyEncrypted', `already password protected: ${input}`);
    const options = $.NSMutableDictionary.dictionary;
    options.setObjectForKey(secret, USER_PASSWORD);
    options.setObjectForKey(secret, OWNER_PASSWORD);
    save(doc, output, options);
    return { outputs: [output], encryption: 'RC4-128' };
  },

  decrypt(input, output) {
    const doc = open(input);
    if (!doc.isEncrypted) throw new ToolError('notEncrypted', `not password protected: ${input}`);
    save(copyPages(doc, range(0, pageCount(doc) - 1)), output);
    return { outputs: [output] };
  },
};

function run(argv) {
  const [command, ...args] = argv;
  try {
    if (!Object.hasOwn(commands, command)) throw new ToolError('badCommand', `unknown command ${command}`);
    return JSON.stringify({ ok: true, ...commands[command](...args) });
  } catch (e) {
    return JSON.stringify({ ok: false, code: e.code || 'failed', error: String(e.message || e) });
  }
}
