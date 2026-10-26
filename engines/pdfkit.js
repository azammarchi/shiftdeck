// Engine: Apple's PDFKit, reached through JavaScript for Automation. Ships with
// every Mac, so it's always there on macOS. See pdfkit.jxa.js for the commands.
const path = require('path');
const { findProgram, runProgram, ToolError } = require('./run');

const SCRIPT = path.join(__dirname, 'pdfkit.jxa.js');
const osascript = process.platform === 'darwin' ? findProgram('osascript') : null;

async function pdfkit(command, args, { password } = {}) {
  if (!osascript) throw new ToolError('noEngine', 'PDFKit needs macOS');
  const env = password ? { SHIFTDECK_PASSWORD: password } : {};
  const { stdout, stderr } = await runProgram(osascript, ['-l', 'JavaScript', SCRIPT, command, ...args.map(String)], { env });
  const line = stdout.trim().split('\n').pop();
  let result;
  try {
    result = JSON.parse(line);
  } catch {
    throw new ToolError('failed', (stderr || stdout).trim() || `osascript gave no result for ${command}`);
  }
  if (!result.ok) throw new ToolError(result.code, result.error);
  delete result.ok;
  return result;
}

module.exports = { available: !!osascript, pdfkit };
