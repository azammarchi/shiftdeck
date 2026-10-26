// Engine: qpdf (optional, `brew install qpdf`). Used for password protection,
// because it writes AES-256 encryption where PDFKit only manages RC4.
//
// Arguments, passwords included, go through a file only this user can read
// (qpdf's @file syntax, one argument per line), so they never show up in `ps`.
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { findProgram, runProgram, ToolError } = require('./run');

// Looked up on every use, so installing qpdf needs no restart.
const program = () => findProgram('qpdf');

async function qpdf(args, workDir) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'qpdf is not installed');
  if (args.some((arg) => /[\r\n]/.test(arg))) throw new ToolError('badOption', 'line breaks are not allowed in passwords');
  const argsFile = path.join(workDir, `.qpdf-${crypto.randomUUID()}`);
  await fsp.writeFile(argsFile, `${args.join('\n')}\n`, { mode: 0o600 });
  try {
    // Exit code 3 means it worked, with warnings about the input.
    const { code, stderr } = await runProgram(file, [`@${argsFile}`]);
    if (code === 0 || code === 3) return;
    if (/invalid password/i.test(stderr)) throw new ToolError('wrongPassword', 'wrong password');
    throw new ToolError('failed', stderr.trim() || `qpdf exited with code ${code}`);
  } finally {
    await fsp.rm(argsFile, { force: true });
  }
}

const encrypt = (input, output, password, workDir) =>
  qpdf(['--encrypt', password, password, '256', '--', input, output], workDir);

const decrypt = (input, output, password, workDir) =>
  qpdf([`--password=${password}`, '--decrypt', input, output], workDir);

module.exports = { available: () => !!program(), encrypt, decrypt };
