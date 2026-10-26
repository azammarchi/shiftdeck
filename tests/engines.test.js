// Engine tests: every tool run on real files with the Mac's own converters,
// checking the results with PDFKit (page count, size, rotation, encryption).
// `npm run test:engines`; macOS only.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runTool, info, engines } = require('../engines');
const { makeSampleFiles, sample, PASSWORD } = require('./sample-files');

const A4 = [595, 842];
const A4_LANDSCAPE = [842, 595];

const input = (name) => ({ path: sample(name), name });
const outDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-test-'));
const run = (tool, names, options = {}) => runTool(tool, names.map(input), options, outDir());
const sizes = async (file, password) => (await info(file, password)).pages.map((p) => p.size);

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code, err.message);
    return true;
  });
}

// Runs with qpdf hidden, to exercise the PDFKit fallback.
async function withoutQpdf(fn) {
  const saved = process.env.SHIFTDECK_DISABLE_ENGINES;
  process.env.SHIFTDECK_DISABLE_ENGINES = 'qpdf';
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete process.env.SHIFTDECK_DISABLE_ENGINES;
    else process.env.SHIFTDECK_DISABLE_ENGINES = saved;
  }
}

before(makeSampleFiles);

test('images to PDF: A4 pages, turned to match each image', async () => {
  const { outputs } = await run('images-to-pdf', ['p1.png', 'photo.heic', 'photo.jpg', 'landscape.png'], { pageSize: 'a4' });
  assert.deepEqual(await sizes(outputs[0]), [A4, A4, A4, A4_LANDSCAPE]);
});

test('images to PDF: Letter and original size', async () => {
  const letter = await run('images-to-pdf', ['p1.png'], { pageSize: 'letter' });
  assert.deepEqual(await sizes(letter.outputs[0]), [[612, 792]]);
  const original = await run('images-to-pdf', ['p1.png'], { pageSize: 'original' });
  assert.deepEqual(await sizes(original.outputs[0]), [[1240, 1754]]);
});

test('images to PDF keeps the full resolution of the image', async () => {
  const { outputs } = await run('images-to-pdf', ['p1.png'], { pageSize: 'a4' });
  const dir = outDir();
  const pngs = await runTool('pdf-to-images', [{ path: outputs[0], name: 'p1.pdf' }], { format: 'png', dpi: 150 }, dir);
  const out = execFileSync('sips', ['-g', 'pixelWidth', pngs.outputs[0]], { encoding: 'utf8' });
  assert.match(out, /pixelWidth: 1240/);
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
  assert.match(execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', png.outputs[0]], { encoding: 'utf8' }), /pixelWidth: 595\s+pixelHeight: 842/);
  const jpeg = await run('pdf-to-images', ['two-pages.pdf'], { format: 'jpeg', dpi: 144 });
  assert.match(execFileSync('sips', ['-g', 'format', '-g', 'pixelWidth', jpeg.outputs[0]], { encoding: 'utf8' }), /pixelWidth: 1190\s+format: jpeg|format: jpeg\s+pixelWidth: 1190/);
  await rejectsWith(run('pdf-to-images', ['two-pages.pdf'], { dpi: 5000 }), 'badOption');
});

test('rotate turns every page, and images of rotated pages come out turned', async () => {
  const rotated = await run('rotate', ['two-pages.pdf'], { degrees: 90 });
  const pages = (await info(rotated.outputs[0])).pages;
  assert.deepEqual(pages.map((p) => p.rotation), [90, 90]);
  assert.deepEqual(pages.map((p) => p.size), [A4_LANDSCAPE, A4_LANDSCAPE]);
  const images = await runTool('pdf-to-images', [{ path: rotated.outputs[0], name: 'r.pdf' }], { format: 'png', dpi: 72 }, outDir());
  assert.match(execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', images.outputs[0]], { encoding: 'utf8' }), /pixelWidth: 842\s+pixelHeight: 595/);
  await rejectsWith(run('rotate', ['two-pages.pdf'], { degrees: 45 }), 'badOption');
});

test('protect and unlock with qpdf use AES-256', { skip: !engines().qpdf && 'qpdf is not installed' }, async () => {
  const { outputs, warnings } = await run('protect', ['two-pages.pdf'], { password: PASSWORD });
  assert.deepEqual(warnings, []);
  const shown = execFileSync('qpdf', [`--password=${PASSWORD}`, '--show-encryption', outputs[0]], { encoding: 'utf8' });
  assert.match(shown, /R = 6/);
  assert.match(shown, /AESv3/);
  assert.equal((await info(outputs[0])).locked, true);
  const unlocked = await runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: PASSWORD }, outDir());
  assert.equal((await info(unlocked.outputs[0])).encrypted, false);
  await rejectsWith(runTool('unlock', [{ path: outputs[0], name: 'p.pdf' }], { password: 'nope' }, outDir()), 'wrongPassword');
});

test('without qpdf, protect falls back to PDFKit and warns that it is weak', () => withoutQpdf(async () => {
  assert.equal(engines().qpdf, false);
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
  await rejectsWith(run('merge', ['three-pages.pdf']), 'tooFewFiles');
  await rejectsWith(run('split', ['notes.txt']), 'wrongType');
  await rejectsWith(run('images-to-pdf', ['three-pages.pdf']), 'wrongType');
  await rejectsWith(run('nonsense', ['three-pages.pdf']), 'badTool');
  await rejectsWith(run('toString', ['three-pages.pdf']), 'badTool');
});

test('file names are data, never commands', async () => {
  const dir = outDir();
  // A shell would create this file in the current folder.
  const marker = 'shiftdeck-pwned';
  const name = `odd $(touch ${marker}) 'name' "x"; \`touch ${marker}\`.pdf`;
  const copy = path.join(dir, name);
  fs.copyFileSync(sample('two-pages.pdf'), copy);
  const { outputs } = await runTool('rotate', [{ path: copy, name }], { degrees: 180 }, dir);
  assert.equal(fs.existsSync(path.join(process.cwd(), marker)), false);
  assert.equal(fs.existsSync(path.join(dir, marker)), false);
  assert.equal((await info(outputs[0])).pages.length, 2);
  assert.ok(!path.basename(outputs[0]).includes('/'));
});

test('each file gets its own folder, so equal names never collide', async () => {
  const { outputs } = await run('rotate', ['two-pages.pdf', 'two-pages.pdf'], { degrees: 90 });
  assert.equal(new Set(outputs).size, 2);
});
