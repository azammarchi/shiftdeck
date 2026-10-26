// Engine: Apple's PDFKit, reached through JavaScript for Automation. Ships with
// every Mac, so on macOS the PDF tools work with nothing installed. See
// pdfkit.jxa.js for the commands.
const path = require('path');
const { findProgram, runProgram, isDisabled, ToolError } = require('./run');

const SCRIPT = path.join(__dirname, 'pdfkit.jxa.js');

const program = () => (process.platform === 'darwin' && !isDisabled('pdfkit') ? findProgram('osascript') : null);

async function pdfkit(command, args, { password } = {}) {
  const osascript = program();
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

module.exports = { available: () => !!program(), pdfkit };
