// Shared helpers for engines: finding programs and running them safely, on
// macOS, Linux and Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const TIMEOUT_MS = 10 * 60 * 1000;
const isWindows = process.platform === 'win32';

// Engines can be switched off with SHIFTDECK_DISABLE_ENGINES=qpdf,pdfkit,...
// (the tests use this to check the fallbacks).
function isDisabled(name) {
  return (process.env.SHIFTDECK_DISABLE_ENGINES || '').split(',').map((s) => s.trim()).includes(name);
}

function subfolders(dir, pattern) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && pattern.test(entry.name))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

// Places installers put programs without always adding them to the PATH, or
// before a new terminal picks the change up: Homebrew's folders on macOS
// (an app started from Finder doesn't get a terminal's PATH), and on Windows
// the install folders of qpdf ("qpdf 12.4.2\bin"), ImageMagick and MuPDF, and
// winget's links and portable packages.
function extraFolders() {
  if (process.platform === 'darwin') return ['/opt/homebrew/bin', '/usr/local/bin'];
  if (!isWindows) return ['/usr/local/bin', '/usr/bin', '/snap/bin'];
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const folders = [];
  for (const root of roots) {
    for (const dir of subfolders(root, /^(qpdf|imagemagick|mupdf)/i)) folders.push(dir, path.join(dir, 'bin'));
  }
  const winget = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet');
  if (winget) {
    folders.push(path.join(winget, 'Links'));
    for (const pkg of subfolders(path.join(winget, 'Packages'), /^(ArtifexSoftware|QPDF|ImageMagick)\./i)) {
      folders.push(pkg, ...subfolders(pkg, /./));
    }
  }
  return folders;
}

// The full path of a program, or null. On Windows only .exe files count, so a
// name can never resolve to a script that would need a shell.
function findProgram(name) {
  if (isDisabled(name)) return null;
  const file = isWindows ? `${name}.exe` : name;
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extraFolders()];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, file);
    try {
      fs.accessSync(candidate, isWindows ? fs.constants.F_OK : fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }
  return null;
}

// Runs a program with an argument array (never through a shell, so file names
// can't be read as commands) and resolves with its output, even when it fails.
// With `binary`, stdout is a Buffer (for image data).
function runProgram(file, args, { env, binary = false } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, {
      env: { ...process.env, ...env },
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 1024,
      encoding: binary ? 'buffer' : 'utf8',
      windowsHide: true,
    }, (err, stdout, stderr) => resolve({
      code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
      stdout,
      stderr: String(stderr),
    }));
  });
}

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// A file only this user can read, for passing secrets to a program; removed
// when `use` finishes.
async function withPrivateFile(dir, content, use) {
  const file = path.join(dir || os.tmpdir(), `.shiftdeck-${require('crypto').randomUUID()}`);
  await fs.promises.writeFile(file, content, { mode: 0o600 });
  try {
    return await use(file);
  } finally {
    await fs.promises.rm(file, { force: true });
  }
}

module.exports = { findProgram, runProgram, withPrivateFile, isDisabled, ToolError, isWindows };
