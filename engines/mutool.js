// Engine: mutool, from MuPDF (https://mupdf.com), on macOS, Linux and Windows.
// Renders PDF pages to images, with each page's rotation applied.
const fsp = require('fs/promises');
const path = require('path');
const { findProgram, runProgram, ToolError } = require('./run');

const program = () => findProgram('mutool');

// Renders every page to `<prefix>-page-<n>.png` in outDir, white background.
async function renderPages(input, outDir, prefix, dpi) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'mutool is not installed');
  // mutool expands %d itself; the % in a file name would confuse it, so it
  // renders into a fresh folder with a fixed name first.
  const dir = await fsp.mkdtemp(path.join(outDir, '.render-'));
  try {
    const { code, stderr } = await runProgram(file, ['draw', '-q', '-r', String(dpi), '-o', path.join(dir, 'page-%d.png'), input]);
    if (code !== 0) {
      if (/password/i.test(stderr)) throw new ToolError('locked', 'password protected');
      throw new ToolError('notPdf', stderr.trim() || 'mutool could not read the file');
    }
    const pages = (await fsp.readdir(dir))
      .map((name) => Number(/^page-(\d+)\.png$/.exec(name)?.[1]))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const outputs = [];
    for (const n of pages) {
      const output = path.join(outDir, `${prefix}-page-${n}.png`);
      await fsp.rename(path.join(dir, `page-${n}.png`), output);
      outputs.push(output);
    }
    return outputs;
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { available: () => !!program(), renderPages };
