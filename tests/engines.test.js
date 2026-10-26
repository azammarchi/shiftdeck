// Engine tests: every tool run on real files, checking the results (page
// count, size, rotation, image size, encryption). The whole suite runs once
// per set of engines this computer has: Apple's PDFKit on macOS, and the
// cross-platform engines (qpdf, mutool, ImageMagick) anywhere.
// `npm run test:engines`.
const { describe, test, before, after } = require('node:test');
const nodeTest = test;
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runTool, info, engines, pageThumbnails } = require('../engines');
const { findProgram } = require('../engines/run');
const { makeSampleFiles, sample, hasSample, imageSize, darkPixels, changedPixels, signatureDataUrl, PASSWORD } = require('./sample-files');

const A4 = [595, 842];
const A4_LANDSCAPE = [842, 595];

const input = (name) => ({ path: sample(name), name });
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-test-'));
const hasMedia = () => hasSample('clip.mp4');
const run = (tool, names, options = {}) => runTool(tool, names.map(input), options, outDir());
const sizes = async (file, password) => (await info(file, password)).pages.map((p) => p.size);
const pixelSize = (file) => {
  const { width, height } = imageSize(file);
  return [width, height];
};

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  });
}

// Runs `fn` with more engines hidden, on top of the mode's own.
async function hiding(names, fn) {
  const saved = process.env.SHIFTDECK_DISABLE_ENGINES;
  process.env.SHIFTDECK_DISABLE_ENGINES = [saved, ...names].filter(Boolean).join(',');
  try {
    return await fn();
  } finally {
    process.env.SHIFTDECK_DISABLE_ENGINES = saved;
  }
}

const withEnv = (disabled, fn) => hiding(disabled, fn);
const modeAvailable = (disabled, check) => {
  const saved = process.env.SHIFTDECK_DISABLE_ENGINES;
  process.env.SHIFTDECK_DISABLE_ENGINES = disabled.join(',');
  try {
    return check(engines());
  } finally {
    if (saved === undefined) delete process.env.SHIFTDECK_DISABLE_ENGINES;
    else process.env.SHIFTDECK_DISABLE_ENGINES = saved;
  }
};

const MODES = [
  { name: 'PDFKit (macOS)', disabled: [], native: true, ok: (e) => e.pdfkit },
  { name: 'qpdf, mutool and ImageMagick', disabled: ['pdfkit'], native: false, ok: (e) => e.qpdf && e.mutool && e.imagemagick },
];

before(makeSampleFiles);

for (const mode of MODES) {
  const available = modeAvailable(mode.disabled, mode.ok);
  describe(mode.name, { skip: !available && 'these engines are not installed' }, () => {
    let saved;
    before(() => {
      saved = process.env.SHIFTDECK_DISABLE_ENGINES;
      process.env.SHIFTDECK_DISABLE_ENGINES = mode.disabled.join(',');
    });
    after(() => {
      if (saved === undefined) delete process.env.SHIFTDECK_DISABLE_ENGINES;
      else process.env.SHIFTDECK_DISABLE_ENGINES = saved;
    });

    test('images to PDF: A4 pages, turned to match each image', async () => {
      const names = ['p1.png', 'photo.jpg', 'photo.heic', 'landscape.png'].filter(hasSample);
      const { outputs } = await run('images-to-pdf', names, { pageSize: 'a4' });
      assert.deepEqual(await sizes(outputs[0]), names.map((n) => (n === 'landscape.png' ? A4_LANDSCAPE : A4)));
    });

    test('images to PDF: Letter and original size', async () => {
      const letter = await run('images-to-pdf', ['p1.png'], { pageSize: 'letter' });
      assert.deepEqual(await sizes(letter.outputs[0]), [[612, 792]]);
      const original = await run('images-to-pdf', ['p1.png'], { pageSize: 'original' });
      assert.deepEqual(await sizes(original.outputs[0]), [[1240, 1754]]);
    });

    test('images to PDF keeps the full resolution of the image', async () => {
      const { outputs } = await run('images-to-pdf', ['p1.png'], { pageSize: 'a4' });
      const pngs = await runTool('pdf-to-images', [{ path: outputs[0], name: 'p1.pdf' }], { format: 'png', dpi: 150 }, outDir());
      // A4 at 150 dpi is 1240 pixels wide, give or take rounding.
      assert.ok(Math.abs(pixelSize(pngs.outputs[0])[0] - 1240) <= 1, `width ${pixelSize(pngs.outputs[0])[0]}`);
    });

    test('images to PDF stores PNG images losslessly', { skip: (mode.native || !findProgram('qpdf')) && 'checked on the PDF writer only' }, async () => {
      const { outputs } = await run('images-to-pdf', ['p1.png'], { pageSize: 'a4' });
      const json = JSON.parse(execFileSync(findProgram('qpdf'), ['--json=2', '--json-key=pages', outputs[0]], { encoding: 'utf8' }));
      assert.deepEqual(json.pages[0].images[0].filter, ['/FlateDecode']);
      assert.equal(json.pages[0].images[0].width, 1240);
    });

    test('merge keeps every page, in order', async () => {
      const { outputs } = await run('merge', ['three-pages.pdf', 'two-pages.pdf']);
      assert.equal(outputs.length, 1);
      assert.equal(path.basename(outputs[0]), 'three-pages-merged.pdf');
      assert.equal((await info(outputs[0])).pages.length, 5);
    });

    test('split: one file per page, or by ranges', async () => {
      const each = await run('split', ['three-pages.pdf']);
      assert.deepEqual(each.outputs.map((f) => path.basename(f)), ['three-pages-page-1.pdf', 'three-pages-page-2.pdf', 'three-pages-page-3.pdf']);
      const ranges = await run('split', ['three-pages.pdf'], { ranges: '1-2, 3' });
      assert.deepEqual(await Promise.all(ranges.outputs.map(async (f) => (await info(f)).pages.length)), [2, 1]);
      await rejectsWith(run('split', ['three-pages.pdf'], { ranges: '2-9' }), 'badRange');
      await rejectsWith(run('split', ['three-pages.pdf'], { ranges: 'abc' }), 'badRange');
    });

    test('PDF to images: PNG and JPEG at the chosen resolution', async () => {
      const png = await run('pdf-to-images', ['two-pages.pdf'], { format: 'png', dpi: 72 });
      assert.deepEqual(png.outputs.map((f) => path.basename(f)), ['two-pages-page-1.png', 'two-pages-page-2.png']);
      assert.deepEqual(pixelSize(png.outputs[0]), A4);
      const jpeg = await run('pdf-to-images', ['two-pages.pdf'], { format: 'jpeg', dpi: 144 });
      assert.deepEqual(jpeg.outputs.map((f) => path.basename(f)), ['two-pages-page-1.jpg', 'two-pages-page-2.jpg']);
      const { format, width } = imageSize(jpeg.outputs[0]);
      assert.equal(format, 'jpeg');
      assert.ok(Math.abs(width - 1190) <= 1, `width ${width}`);
      await rejectsWith(run('pdf-to-images', ['two-pages.pdf'], { dpi: 5000 }), 'badOption');
    });

    test('rotate turns every page, and images of rotated pages come out turned', async () => {
      const rotated = await run('rotate', ['two-pages.pdf'], { degrees: 90 });
      const pages = (await info(rotated.outputs[0])).pages;
      assert.deepEqual(pages.map((p) => p.rotation), [90, 90]);
      assert.deepEqual(pages.map((p) => p.size), [A4_LANDSCAPE, A4_LANDSCAPE]);
      const images = await runTool('pdf-to-images', [{ path: rotated.outputs[0], name: 'r.pdf' }], { format: 'png', dpi: 72 }, outDir());
      assert.deepEqual(pixelSize(images.outputs[0]), A4_LANDSCAPE);
      await rejectsWith(run('rotate', ['two-pages.pdf'], { degrees: 45 }), 'badOption');
    });

    test('organize: pages in a new order, each turned, some removed', async () => {
      const { outputs } = await run('organize', ['mixed.pdf'], { pages: [{ page: 2 }, { page: 1, turn: 90 }, { page: 3, turn: 180 }] });
      assert.equal(path.basename(outputs[0]), 'mixed-organized.pdf');
      const pages = (await info(outputs[0])).pages;
      assert.deepEqual(pages.map((p) => p.size), [A4_LANDSCAPE, A4_LANDSCAPE, A4]);
      assert.deepEqual(pages.map((p) => p.rotation), [0, 90, 180]);
      const one = await run('organize', ['mixed.pdf'], { pages: [{ page: 3 }] });
      assert.equal((await info(one.outputs[0])).pages.length, 1);
    });

    test('organize refuses what can\'t be done', async () => {
      await rejectsWith(run('organize', ['mixed.pdf'], { pages: [] }), 'noPages');
      await rejectsWith(run('organize', ['mixed.pdf'], {}), 'noPages');
      await rejectsWith(run('organize', ['mixed.pdf'], { pages: [{ page: 4 }] }), 'badOption');
      await rejectsWith(run('organize', ['mixed.pdf'], { pages: [{ page: 1, turn: 45 }] }), 'badOption');
      await rejectsWith(run('organize', ['mixed.pdf', 'two-pages.pdf'], { pages: [{ page: 1 }] }), 'tooManyFiles');
      await rejectsWith(run('organize', ['protected.pdf'], { pages: [{ page: 1 }] }), 'locked');
    });

    test('page thumbnails: one small picture per page, as the page is shown', async () => {
      const thumbnails = await pageThumbnails(sample('mixed.pdf'), outDir());
      assert.equal(thumbnails.length, 3);
      assert.deepEqual(thumbnails.map((p) => p.size), [A4, A4_LANDSCAPE, A4]);
      const [w, h] = pixelSize(thumbnails[1].image);
      assert.ok(w > h && w < 600, `landscape thumbnail ${w}x${h}`);
    });

    // Renders a PDF's pages and says which regions have dark marks on them.
    const marks = async (pdf, region) => {
      const { outputs } = await runTool('pdf-to-images', [{ path: pdf, name: 'check.pdf' }], { format: 'png', dpi: 50 }, outDir());
      return outputs.map((png) => darkPixels(png, region) > 0);
    };
    const BOTTOM_CENTER = [0.35, 0.88, 0.65, 1];
    const TOP_RIGHT = [0.7, 0, 1, 0.12];
    const BOTTOM_RIGHT = [0.55, 0.7, 1, 1];

    test('page numbers go where asked, upright on turned pages too', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      const { outputs } = await run('page-numbers', ['mixed.pdf'], { template: 'Page {n} of {total}', skipFirst: true });
      assert.equal(path.basename(outputs[0]), 'mixed-numbered.pdf');
      assert.deepEqual(await marks(outputs[0], BOTTOM_CENTER), [false, true, true]);
      assert.deepEqual(await marks(outputs[0], TOP_RIGHT), [false, false, false]);

      const topRight = await run('page-numbers', ['two-pages.pdf'], { position: 'top-right', start: 7, size: 20 });
      assert.deepEqual(await marks(topRight.outputs[0], TOP_RIGHT), [true, true]);

      // A page turned 90°: the number sits at the bottom of the page as shown.
      // (A text with some ink: a lone thin "1" can stay too light to count
      // at this resolution.)
      const turned = await run('rotate', ['two-pages.pdf'], { degrees: 90 });
      const numbered = await runTool('page-numbers', [{ path: turned.outputs[0], name: 't.pdf' }], { template: 'Page {n} of {total}' }, outDir());
      assert.deepEqual(await marks(numbered.outputs[0], BOTTOM_CENTER), [true, true]);
      assert.deepEqual(await marks(numbered.outputs[0], [0, 0, 0.15, 1]), [false, false]);
    });

    test('page numbers refuse text without {n} and unknown positions', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      await rejectsWith(run('page-numbers', ['mixed.pdf'], { template: 'Chapter one' }), 'badOption');
      await rejectsWith(run('page-numbers', ['mixed.pdf'], { position: 'middle' }), 'badOption');
      await rejectsWith(run('page-numbers', ['protected.pdf'], {}), 'locked');
    });

    test('a signature goes on the page and corner asked, only there', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      const last = await run('sign', ['mixed.pdf'], { signature: signatureDataUrl() });
      assert.equal(path.basename(last.outputs[0]), 'mixed-signed.pdf');
      assert.deepEqual(await marks(last.outputs[0], BOTTOM_RIGHT), [false, false, true]);
      const first = await run('sign', ['mixed.pdf'], { signature: signatureDataUrl(), page: 1, position: 'top-left', width: 200 });
      assert.deepEqual(await marks(first.outputs[0], [0, 0, 0.5, 0.25]), [true, false, false]);
      assert.deepEqual(await marks(first.outputs[0], BOTTOM_RIGHT), [false, false, false]);
    });

    test('signing refuses a missing or broken signature and pages that don\'t exist', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      await rejectsWith(run('sign', ['mixed.pdf'], {}), 'noSignature');
      await rejectsWith(run('sign', ['mixed.pdf'], { signature: 'data:image/png;base64,AAAA' }), 'badOption');
      await rejectsWith(run('sign', ['mixed.pdf'], { signature: signatureDataUrl(), page: 9 }), 'badOption');
      await rejectsWith(run('sign', ['protected.pdf'], { signature: signatureDataUrl() }), 'locked');
    });

    const renders = async (pdf) => (await runTool('pdf-to-images', [{ path: pdf, name: 'check.pdf' }], { format: 'png', dpi: 40 }, outDir())).outputs;

    test('a watermark crosses the middle of every page, and leaves the corners alone', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      const { outputs } = await run('watermark', ['mixed.pdf'], { text: 'CONFIDENTIAL', opacity: 60 });
      assert.equal(path.basename(outputs[0]), 'mixed-watermarked.pdf');
      const [before, after] = [await renders(sample('mixed.pdf')), await renders(outputs[0])];
      for (let i = 0; i < 3; i++) {
        assert.ok(changedPixels(before[i], after[i], [0.3, 0.3, 0.7, 0.7]) > 50, `page ${i + 1} middle`);
        // Inside the corner, past the outermost pixel row: rewriting a page can
        // shift its edge by a fraction of a pixel.
        assert.equal(changedPixels(before[i], after[i], [0.02, 0.02, 0.12, 0.12]), 0, `page ${i + 1} corner`);
      }
      const flat = await run('watermark', ['two-pages.pdf'], { text: 'DRAFT', style: 'horizontal' });
      const [b, a] = [await renders(sample('two-pages.pdf')), await renders(flat.outputs[0])];
      assert.ok(changedPixels(b[0], a[0], [0.1, 0.45, 0.9, 0.55]) > 50);
      assert.equal(changedPixels(b[0], a[0], [0.02, 0.02, 0.98, 0.3]), 0);
      await rejectsWith(run('watermark', ['mixed.pdf'], { text: ' ' }), 'noText');
      await rejectsWith(run('watermark', ['mixed.pdf'], { text: 'x', opacity: 0 }), 'badOption');
    });

    test('compress makes photo PDFs much smaller, and never bigger', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      const original = fs.statSync(sample('photo.pdf')).size;
      const smaller = await run('compress', ['photo.pdf'], { level: 'smaller' });
      assert.equal(path.basename(smaller.outputs[0]), 'photo-compressed.pdf');
      assert.ok(fs.statSync(smaller.outputs[0]).size < original * 0.3, 'smaller is under 30%');
      assert.equal((await info(smaller.outputs[0])).pages.length, 1);
      const smallest = await run('compress', ['photo.pdf'], { level: 'smallest' });
      assert.ok(fs.statSync(smallest.outputs[0]).size < fs.statSync(smaller.outputs[0]).size);
      const lossless = await run('compress', ['photo.pdf'], { level: 'lossless' });
      assert.ok(fs.statSync(lossless.outputs[0]).size <= original);
      // Already compressed: the result is never bigger than what went in.
      const again = await runTool('compress', [{ path: smallest.outputs[0], name: 'again.pdf' }], { level: 'lossless' }, outDir());
      assert.ok(fs.statSync(again.outputs[0]).size <= fs.statSync(smallest.outputs[0]).size);
      await rejectsWith(run('compress', ['photo.pdf'], { level: 'tiny' }), 'badOption');
      await rejectsWith(run('compress', ['protected.pdf'], {}), 'locked');
    });

    test('protect and unlock with qpdf use AES-256', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
      const { outputs, warnings } = await run('protect', ['two-pages.pdf'], { password: PASSWORD });
      assert.deepEqual(warnings, []);
      const shown = execFileSync(findProgram('qpdf'), [`--password=${PASSWORD}`, '--show-encryption', outputs[0]], { encoding: 'utf8' });
      assert.match(shown, /R = 6/);
      assert.match(shown, /AESv3/);
      assert.equal((await info(outputs[0])).locked, true);
      const unlocked = await runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: PASSWORD }, outDir());
      assert.equal((await info(unlocked.outputs[0])).encrypted, false);
      await rejectsWith(runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: 'nope' }, outDir()), 'wrongPassword');
    });

    test('without qpdf, PDFKit protects weakly and says so; other engines can\'t protect at all', () => hiding(['qpdf'], async () => {
      assert.equal(engines().qpdf, false);
      if (!mode.native) {
        await rejectsWith(run('protect', ['two-pages.pdf'], { password: PASSWORD }), 'noEngine');
        return;
      }
      const { outputs, warnings } = await run('protect', ['two-pages.pdf'], { password: PASSWORD });
      assert.deepEqual(warnings, ['weakEncryption']);
      const state = await info(outputs[0]);
      assert.equal(state.encrypted, true);
      assert.equal(state.locked, true);
      assert.equal((await info(outputs[0], PASSWORD)).pages.length, 2);
      const unlocked = await runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: PASSWORD }, outDir());
      assert.equal((await info(unlocked.outputs[0])).encrypted, false);
      await rejectsWith(runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: 'nope' }, outDir()), 'wrongPassword');
    }));

    test('password tools refuse what makes no sense', async () => {
      await rejectsWith(run('protect', ['two-pages.pdf'], {}), 'noPassword');
      await rejectsWith(run('protect', ['protected.pdf'], { password: 'x' }), 'alreadyEncrypted');
      await rejectsWith(run('unlock', ['two-pages.pdf'], { password: 'x' }), 'notEncrypted');
    });

    test('protected PDFs and wrong inputs give clear errors', async () => {
      await rejectsWith(run('merge', ['three-pages.pdf', 'protected.pdf']), 'locked');
      await rejectsWith(run('split', ['protected.pdf']), 'locked');
      await rejectsWith(run('merge', ['three-pages.pdf']), 'tooFewFiles');
      await rejectsWith(run('split', ['notes.txt']), 'wrongType');
      await rejectsWith(run('images-to-pdf', ['three-pages.pdf']), 'wrongType');
      await rejectsWith(run('nonsense', ['three-pages.pdf']), 'badTool');
      await rejectsWith(run('toString', ['three-pages.pdf']), 'badTool');
    });

    test('a file that only looks like a PDF is refused', async () => {
      const dir = outDir();
      const fake = path.join(dir, 'fake.pdf');
      fs.copyFileSync(sample('notes.txt'), fake);
      await rejectsWith(runTool('rotate', [{ path: fake, name: 'fake.pdf' }], { degrees: 90 }, dir), 'notPdf');
    });

    test('file names are data, never commands', async () => {
      const dir = outDir();
      // A shell would create this file in the current folder. Windows doesn't
      // allow " in file names, so it isn't used.
      const marker = 'shiftdeck-pwned';
      const name = `odd $(touch ${marker}) 'name' & echo %PATH% ; \`touch ${marker}\`.pdf`;
      const copy = path.join(dir, name);
      fs.copyFileSync(sample('two-pages.pdf'), copy);
      const { outputs } = await runTool('rotate', [{ path: copy, name }], { degrees: 180 }, dir);
      assert.equal(fs.existsSync(path.join(process.cwd(), marker)), false);
      assert.equal(fs.existsSync(path.join(dir, marker)), false);
      assert.equal((await info(outputs[0])).pages.length, 2);
    });

    test('each file gets its own folder, so equal names never collide', async () => {
      const { outputs } = await run('rotate', ['two-pages.pdf', 'two-pages.pdf'], { degrees: 90 });
      assert.equal(new Set(outputs).size, 2);
    });
  });
}

describe('Convert images', { skip: !engines().imagemagick && 'ImageMagick is not installed' }, () => {
  const imagemagick = require('../engines/imagemagick');
  const convert = async (name, options) => (await run('convert-images', [name], options)).outputs[0];
  const describeImage = (file) => imagemagick.identify(file, '%m %w %h');
  const exif = (file) => imagemagick.identify(file, '%[EXIF:*]');
  let writable;
  before(async () => {
    writable = await imagemagick.writableFormats();
  });

  test('PNG, JPEG, WebP and TIFF keep the image\'s size', async () => {
    for (const [format, magick, ext] of [['jpeg', 'JPEG', 'jpg'], ['png', 'PNG', 'png'], ['webp', 'WEBP', 'webp'], ['tiff', 'TIFF', 'tiff']]) {
      if (!writable.includes(format)) continue;
      const output = await convert('p1.png', { format });
      assert.equal(path.basename(output), `p1.${ext}`);
      assert.equal(await describeImage(output), `${magick} 1240 1754`);
    }
    assert.ok(writable.includes('jpeg') && writable.includes('png'), `writable: ${writable}`);
  });

  test('HEIC, where this computer can write it', async (t) => {
    if (!writable.includes('heic')) return t.skip('ImageMagick here can\'t write HEIC');
    const output = await convert('p1.png', { format: 'heic', quality: 80 });
    assert.match(await describeImage(output), /^HEIC 1240 1754$/);
  });

  test('the longest side shrinks to the size asked, and never grows', async () => {
    const [, w, h] = (await describeImage(await convert('p1.png', { format: 'png', maxSize: 500 }))).split(' ').map(Number);
    assert.equal(h, 500);
    assert.ok(Math.abs(w - 353.5) <= 1, `width ${w}`);
    assert.equal(await describeImage(await convert('p1.png', { format: 'png', maxSize: 5000 })), 'PNG 1240 1754');
  });

  test('phone photos come out upright, without their location or camera', { skip: !hasSample('phone-photo.jpg') && 'no JPEG sample' }, async () => {
    const before = await exif(sample('phone-photo.jpg'));
    assert.match(before, /GPSLatitude/);
    assert.match(before, /ShiftdeckCam/);
    const output = await convert('phone-photo.jpg', { format: 'jpeg' });
    assert.equal(await describeImage(output), 'JPEG 1754 1240'); // turned upright
    const after = await exif(output);
    assert.doesNotMatch(after, /GPS/);
    assert.doesNotMatch(after, /ShiftdeckCam/);
  });

  test('keeping the details keeps the location, still upright', { skip: !hasSample('phone-photo.jpg') && 'no JPEG sample' }, async () => {
    const output = await convert('phone-photo.jpg', { format: 'jpeg', stripMetadata: false });
    assert.equal(await describeImage(output), 'JPEG 1754 1240');
    const after = await exif(output);
    assert.match(after, /GPSLatitude/);
    assert.match(after, /ShiftdeckCam/);
    assert.match(await imagemagick.identify(output, '%[orientation]'), /TopLeft|Undefined/);
  });

  test('lower quality makes smaller JPEGs', async () => {
    const low = fs.statSync(await convert('p1.png', { format: 'jpeg', quality: 20 })).size;
    const high = fs.statSync(await convert('p1.png', { format: 'jpeg', quality: 98 })).size;
    assert.ok(low < high, `${low} < ${high}`);
  });

  test('wrong options and files are refused', async () => {
    await rejectsWith(run('convert-images', ['p1.png'], { format: 'jpeg', quality: 0 }), 'badOption');
    await rejectsWith(run('convert-images', ['p1.png'], { format: 'jpeg', quality: 'abc' }), 'badOption');
    await rejectsWith(run('convert-images', ['p1.png'], { format: 'png', maxSize: 2.5 }), 'badOption');
    await rejectsWith(run('convert-images', ['p1.png'], { format: 'gif' }), 'badOption');
    await rejectsWith(run('convert-images', ['three-pages.pdf'], { format: 'png' }), 'wrongType');
    const dir = outDir();
    const fake = path.join(dir, 'fake.png');
    fs.copyFileSync(sample('notes.txt'), fake);
    await rejectsWith(runTool('convert-images', [{ path: fake, name: 'fake.png' }], { format: 'jpeg' }, dir), 'notImage');
  });
});

// The media samples only exist once before() has made them, so whether
// these tests can run is decided as each one starts.
describe('Audio and video', () => {
  const test = (name, fn) => nodeTest(name, async (t) => {
    if (!hasMedia()) return t.skip('ffmpeg is not installed, or does not start');
    return fn(t);
  });
  const ffmpeg = require('../engines/ffmpeg');
  const streams = async (file) => (await ffmpeg.probe(file)).streams;
  let audioFormats;
  let videoFormats;
  before(async () => {
    audioFormats = (await require('../engines').TOOLS['convert-audio'].details()).formats;
    videoFormats = (await require('../engines').TOOLS['convert-video'].details()).formats;
  });

  test('audio converts to every format this ffmpeg can write, keeping its length', async () => {
    const codecs = { mp3: 'mp3', m4a: 'aac', ogg: 'vorbis', opus: 'opus', flac: 'flac', wav: 'pcm_s16le' };
    assert.ok(audioFormats.includes('wav') && audioFormats.includes('flac'), `audio formats: ${audioFormats}`);
    for (const format of audioFormats) {
      const { outputs } = await run('convert-audio', ['tone.wav'], { format, bitrate: 128 });
      const probe = await ffmpeg.probe(outputs[0]);
      assert.equal(probe.streams[0].codec, codecs[format], format);
      assert.ok(Math.abs(probe.duration - 2) < 0.2, `${format} lasts ${probe.duration}`);
    }
  });

  test('the sound of a video comes out on its own', async () => {
    const { outputs } = await run('convert-audio', ['clip.mp4'], { format: 'wav' });
    assert.deepEqual((await streams(outputs[0])).map((s) => s.type), ['audio']);
  });

  test('video converts, shrinks to the size asked, and can lose its sound', async () => {
    assert.ok(videoFormats.includes('gif'), `video formats: ${videoFormats}`);
    for (const format of videoFormats.filter((f) => f !== 'gif')) {
      const { outputs } = await run('convert-video', ['clip.mp4'], { format, quality: 'small' });
      const types = (await streams(outputs[0])).map((s) => s.type).sort();
      assert.deepEqual(types, ['audio', 'video'], format);
    }
    if (videoFormats.includes('mp4')) {
      const { outputs } = await run('convert-video', ['clip.mp4'], { format: 'mp4', height: '360' });
      // Never larger than the original: 240 stays 240.
      assert.equal((await streams(outputs[0])).find((s) => s.type === 'video').height, 240);
      const small = await run('convert-video', ['long-clip.mp4'], { format: 'mp4', height: '360', removeAudio: true, quality: 'small' });
      const video = await streams(small.outputs[0]);
      assert.deepEqual(video.map((s) => [s.type, s.width, s.height]), [['video', 480, 360]]);
    }
  });

  test('a clip becomes a GIF', async () => {
    const { outputs } = await run('convert-video', ['clip.mp4'], { format: 'gif' });
    assert.equal(path.basename(outputs[0]), 'clip.gif');
    assert.equal((await streams(outputs[0]))[0].codec, 'gif');
  });

  test('progress is reported, and a long conversion can be stopped', async () => {
    const seen = [];
    await runTool('convert-audio', [input('tone.wav')], { format: 'wav' }, outDir(), { onProgress: (p) => seen.push(p) });
    assert.equal(seen.at(-1), 1);
    assert.ok(seen.every((p, i) => i === 0 || p >= seen[i - 1]), `progress goes forward: ${seen}`);

    const controller = new AbortController();
    const dir = outDir();
    const started = runTool('convert-video', [input('long-clip.mp4')], { format: 'webm', quality: 'high' }, dir, {
      signal: controller.signal,
      onProgress: (p) => { if (p > 0) controller.abort(); },
    });
    await rejectsWith(started, 'cancelled');
    assert.deepEqual(fs.readdirSync(dir), [], 'nothing is left behind');
  });

  test('files that aren\'t audio or video are refused', async () => {
    const dir = outDir();
    const fake = path.join(dir, 'fake.mp3');
    fs.copyFileSync(sample('notes.txt'), fake);
    await rejectsWith(runTool('convert-audio', [{ path: fake, name: 'fake.mp3' }], { format: 'wav' }, dir), 'notMedia');
    await rejectsWith(run('convert-audio', ['tone.wav'], { format: 'aiff' }), 'badOption');
    await rejectsWith(run('convert-video', ['clip.mp4'], { format: 'mp4', height: '1234' }), 'badOption');
  });
});

describe('Documents to PDF', { skip: !engines().libreoffice && 'LibreOffice is not installed' }, () => {
  test('Word, RTF, HTML, CSV and text become PDFs with their text on the page', async () => {
    for (const name of ['letter.docx', 'note.rtf', 'page.html', 'table.csv', 'readme.txt']) {
      const { outputs } = await run('documents-to-pdf', [name]);
      assert.equal(path.basename(outputs[0]), `${name.replace(/\.[^.]+$/, '')}.pdf`);
      const { pages } = await info(outputs[0]);
      assert.ok(pages.length >= 1, `${name}: ${pages.length} pages`);
      // At 100 dpi, so the small print of a spreadsheet counts too.
      const images = await runTool('pdf-to-images', [{ path: outputs[0], name: 'doc.pdf' }], { format: 'png', dpi: 100 }, outDir());
      assert.ok(darkPixels(images.outputs[0], [0, 0, 1, 1]) > 20, `${name}: text on the first page`);
    }
  });

  test('several documents convert side by side, each with its own LibreOffice profile', async () => {
    const results = await Promise.all(['letter.docx', 'note.rtf', 'readme.txt'].map((name) => run('documents-to-pdf', [name])));
    for (const { outputs } of results) assert.ok((await info(outputs[0])).pages.length >= 1);
  });

  test('only document files are taken', async () => {
    await rejectsWith(run('documents-to-pdf', ['p1.png']), 'wrongType');
  });
});

test('with no engine at all, tools say what to install', () => withEnv(['pdfkit', 'qpdf', 'mutool', 'imagemagick'], async () => {
  await rejectsWith(run('merge', ['three-pages.pdf', 'two-pages.pdf']), 'noEngine');
  await rejectsWith(run('images-to-pdf', ['p1.png']), 'noEngine');
}));
