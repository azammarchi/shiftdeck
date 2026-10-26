// Engine: LibreOffice (https://www.libreoffice.org), on macOS, Linux and
// Windows, run without a window ("headless"). Turns documents, spreadsheets
// and presentations into PDF.
//
// LibreOffice keeps one profile per user and won't run twice on it, so each
// conversion gets its own temporary profile: conversions can then run side
// by side, and never touch the user's own LibreOffice settings.
const fsp = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');
const { findProgram, runProgram, ToolError } = require('./run');

// The program is `soffice`; some Linux packages only add `libreoffice`.
const program = () => findProgram('soffice') || findProgram('libreoffice');

// Converts `input` to PDF as `output`. Stops when `signal` aborts.
async function toPdf(input, output, { signal } = {}) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'LibreOffice is not installed: run npm run setup');
  const work = await fsp.mkdtemp(path.join(path.dirname(output), 'office-'));
  try {
    const { code, stderr, stdout } = await runProgram(file, [
      `-env:UserInstallation=${pathToFileURL(path.join(work, 'profile')).href}`,
      '--headless', '--norestore', '--nologo', '--nolockcheck',
      '--convert-to', 'pdf', '--outdir', work, input,
    ], { signal });
    if (signal?.aborted) throw new ToolError('cancelled', 'cancelled');
    // LibreOffice names the PDF after the input; it says nothing useful on
    // failure, and sometimes exits 0 without writing anything.
    const made = path.join(work, `${path.basename(input, path.extname(input))}.pdf`);
    try {
      await fsp.rename(made, output);
    } catch {
      throw new ToolError(code === 0 ? 'notDocument' : 'failed', (stderr || stdout).trim() || 'LibreOffice could not convert this file');
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

module.exports = { available: () => !!program(), toPdf };
