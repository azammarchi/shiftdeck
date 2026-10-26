// Engine tests: every tool run on real files, checking the results (page
// count, size, rotation, image size, encryption). The whole suite runs once
// per set of engines this computer has: Apple's PDFKit on macOS, and the
// cross-platform engines (qpdf, mutool, ImageMagick) anywhere.
// `npm run test:engines`.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runTool, info, engines } = require('../engines');
const { findProgram } = require('../engines/run');
const { makeSampleFiles, sample, hasSample, imageSize, PASSWORD } = require('./sample-files');

const A4 = [595, 842];
const A4_LANDSCAPE = [842, 595];

const input = (name) => ({ path: sample(name), name });
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-test-'));
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

test('with no engine at all, tools say what to install', () => withEnv(['pdfkit', 'qpdf', 'mutool', 'imagemagick'], async () => {
  await rejectsWith(run('merge', ['three-pages.pdf', 'two-pages.pdf']), 'noEngine');
  await rejectsWith(run('images-to-pdf', ['p1.png']), 'noEngine');
}));
