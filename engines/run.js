// Shared helpers for engines: finding programs and running them safely.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const TIMEOUT_MS = 10 * 60 * 1000;

// Engines can be switched off with SHIFTDECK_DISABLE_ENGINES=qpdf,... (the
// tests use this to check the fallbacks).
function isDisabled(name) {
  return (process.env.SHIFTDECK_DISABLE_ENGINES || '').split(',').map((s) => s.trim()).includes(name);
}

// Homebrew's folders are added because an app started from Finder or launchd
// doesn't get the PATH a terminal has.
function findProgram(name) {
  if (isDisabled(name)) return null;
  const dirs = [...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const dir of dirs) {
    if (!dir) continue;
    const file = path.join(dir, name);
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return file;
    } catch {}
  }
  return null;
}

// Runs a program with an argument array (never through a shell, so file names
// can't be read as commands) and resolves with its output, even when it fails.
function runProgram(file, args, { env } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, ...env }, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr }));
  });
}

class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

module.exports = { findProgram, runProgram, ToolError };
