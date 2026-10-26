// The shiftdeck command: tools from a terminal, and the watched folder.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { engines } = require('../engines');
const { makeSampleFiles, sample } = require('./sample-files');

const CLI = path.join(__dirname, '..', 'bin', 'shiftdeck.js');
const shiftdeck = (args, cwd) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-cli-test-'));

before(makeSampleFiles);

test('tools lists every tool and whether it works here', () => {
  const { status, stdout } = shiftdeck(['tools']);
  assert.equal(status, 0);
  for (const tool of ['merge', 'split', 'convert-images', 'convert-audio', 'documents-to-pdf']) assert.match(stdout, new RegExp(`[✓✗] ${tool}`));
});

test('a tool runs on files, and its results never overwrite each other', { skip: !(engines().pdfkit || engines().qpdf) && 'no PDF engine' }, () => {
  const dir = tempDir();
  for (let i = 0; i < 2; i++) {
    const { status, stderr } = shiftdeck(['merge', sample('three-pages.pdf'), sample('two-pages.pdf'), '--out', 'merged'], dir);
    assert.equal(status, 0, stderr);
  }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'merged')).sort(), ['three-pages-merged (2).pdf', 'three-pages-merged.pdf']);
});

test('options are passed on, and the tool checks them', { skip: !engines().imagemagick && 'ImageMagick is not installed' }, () => {
  const dir = tempDir();
  const ok = shiftdeck(['convert-images', '--format', 'png', '--max-size=300', sample('p1.png')], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(fs.readFileSync(path.join(dir, 'p1.png')).readUInt32BE(20), 300); // PNG height
  const bad = shiftdeck(['convert-images', '--quality', '0', '--format', 'jpeg', sample('p1.png')], dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /quality must be a whole number/);
});

test('unknown tools and missing files are explained', () => {
  const unknown = shiftdeck(['shrink', 'a.pdf']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown tool or command "shrink"/);
  const none = shiftdeck(['merge']);
  assert.match(none.stderr, /no files given/);
  assert.match(shiftdeck(['help']).stdout, /shiftdeck watch <folder>/);
});

test('a watched folder converts new files, and leaves the others alone', { skip: !(engines().pdfkit || engines().qpdf) && 'no PDF engine' }, async () => {
  const dir = tempDir();
  fs.copyFileSync(sample('two-pages.pdf'), path.join(dir, 'before.pdf'));
  const watcher = spawn(process.execPath, [CLI, 'watch', dir, '--tool', 'rotate', '--degrees', '180'], {
    env: { ...process.env, SHIFTDECK_WATCH_READY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      watcher.stdout.on('data', (chunk) => { if (String(chunk).includes('ready')) resolve(); });
      watcher.on('exit', (code) => reject(new Error(`watch exited with ${code}`)));
    });
    fs.copyFileSync(sample('two-pages.pdf'), path.join(dir, 'arrived.pdf'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a PDF');
    const result = path.join(dir, 'converted', 'arrived-rotated.pdf');
    for (let waited = 0; !fs.existsSync(result) && waited < 30000; waited += 250) await new Promise((r) => setTimeout(r, 250));
    assert.ok(fs.existsSync(result), 'the new file was converted');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'converted')), ['arrived-rotated.pdf']);
  } finally {
    watcher.kill();
  }
});
