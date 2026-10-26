// Engine: qpdf (https://qpdf.readthedocs.io), on macOS, Linux and Windows.
// Merges, splits and rotates PDFs, reads their pages, and adds or removes
// passwords with AES-256 encryption.
//
// Arguments, passwords included, go through a file only this user can read
// (qpdf's @file syntax, one argument per line), so they never show up in `ps`.
const { findProgram, runProgram, withPrivateFile, ToolError } = require('./run');

// Looked up on every use, so installing qpdf needs no restart.
const program = () => findProgram('qpdf');

async function qpdf(args, { workDir, password } = {}) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'qpdf is not installed');
  if (args.some((arg) => /[\r\n]/.test(arg))) throw new ToolError('badOption', 'line breaks are not allowed in passwords or file names');
  return withPrivateFile(workDir, `${args.join('\n')}\n`, async (argsFile) => {
    // Exit code 3 means it worked, with warnings about the input.
    const result = await runProgram(file, [`@${argsFile}`]);
    if (result.code === 0 || result.code === 3) return result;
    if (/invalid password/i.test(result.stderr)) {
      throw password ? new ToolError('wrongPassword', 'wrong password') : new ToolError('locked', 'password protected');
    }
    if (/not a PDF|can't find PDF header|unable to find trailer|startxref/i.test(result.stderr)) {
      throw new ToolError('notPdf', result.stderr.trim());
    }
    throw new ToolError('failed', result.stderr.trim() || `qpdf exited with code ${result.code}`);
  });
}

// Follows /Parent links, since a page can inherit its /MediaBox and /Rotate.
function inherited(objects, ref, key) {
  for (let seen = 0, current = ref; current && seen < 64; seen++) {
    const value = objects[`obj:${current}`]?.value;
    if (!value) return undefined;
    if (key in value) return value[key];
    current = value['/Parent'];
  }
  return undefined;
}

// { encrypted, locked, pages: [{ size: [w, h] as shown, rotation }] }
async function info(input, { password, workDir } = {}) {
  let result;
  try {
    result = await qpdf([
      ...(password ? [`--password=${password}`] : []),
      '--json=2', '--json-key=pages', '--json-key=qpdf', '--json-key=encrypt', input,
    ], { workDir, password });
  } catch (err) {
    if (err.code === 'locked' || err.code === 'wrongPassword') return { encrypted: true, locked: true };
    throw err;
  }
  const json = JSON.parse(result.stdout);
  const objects = json.qpdf[1];
  const pages = json.pages.map((page) => {
    const [x1, y1, x2, y2] = inherited(objects, page.object, '/MediaBox') || [0, 0, 612, 792];
    const rotation = ((Number(inherited(objects, page.object, '/Rotate')) || 0) % 360 + 360) % 360;
    const width = Math.round(Math.abs(x2 - x1));
    const height = Math.round(Math.abs(y2 - y1));
    return { size: rotation % 180 === 0 ? [width, height] : [height, width], rotation };
  });
  return { encrypted: !!json.encrypt.encrypted, locked: false, pages };
}

const merge = (output, inputs, workDir) =>
  qpdf(['--empty', '--pages', ...inputs, '--', output], { workDir });

const extract = (input, from, to, output, workDir) =>
  qpdf(['--empty', '--pages', input, from === to ? `${from}` : `${from}-${to}`, '--', output], { workDir });

const rotate = (input, output, degrees, workDir) =>
  qpdf([input, output, `--rotate=+${degrees}`], { workDir });

const encrypt = (input, output, password, workDir) =>
  qpdf(['--encrypt', password, password, '256', '--', input, output], { workDir });

const decrypt = (input, output, password, workDir) =>
  qpdf([`--password=${password}`, '--decrypt', input, output], { workDir, password });

module.exports = {
  available: () => !!program(),
  info,
  merge,
  extract,
  rotate,
  encrypt,
  decrypt,
};
