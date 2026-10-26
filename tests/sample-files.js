// Sample files for the tests, made fresh with the Mac's own tools (nothing is
// checked into the repo): numbered A4 pages as PNG, the same in HEIC and JPEG,
// a landscape image, PDFs made from them and a password-protected PDF.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { runTool } = require('../engines');

// Outside test-results/, which Playwright empties when it starts.
const DIR = path.join(os.tmpdir(), 'shiftdeck-test-samples');
const PASSWORD = 'open sesame';

async function makeSampleFiles() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  execFileSync('osascript', ['-l', 'JavaScript', path.join(__dirname, 'draw-pages.jxa.js'), DIR]);
  const file = (name) => path.join(DIR, name);
  execFileSync('sips', ['-s', 'format', 'heic', file('p1.png'), '--out', file('photo.heic')], { stdio: 'ignore' });
  execFileSync('sips', ['-s', 'format', 'jpeg', file('p2.png'), '--out', file('photo.jpg')], { stdio: 'ignore' });
  execFileSync('sips', ['-r', '90', file('p3.png'), '--out', file('landscape.png')], { stdio: 'ignore' });
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

module.exports = { makeSampleFiles, sample, PASSWORD };
