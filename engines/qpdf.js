// Engine: qpdf (https://qpdf.readthedocs.io), on macOS, Linux and Windows.
// Merges, splits and rotates PDFs, reads their pages, and adds or removes
// passwords with AES-256 encryption.
//
// Commands that carry a password are given to qpdf as a JSON job file
// (--job-json-file) that only this user can read, so the password never
// shows up in `ps`. Other commands get their arguments directly, which is
// just as safe: no shell is ever involved.
const { findProgram, runProgram, withPrivateFile, ToolError } = require('./run');

// Looked up on every use, so installing qpdf needs no restart.
const program = () => findProgram('qpdf');

function check(result, password) {
  // Exit code 3 means it worked, with warnings about the input.
  if (result.code === 0 || result.code === 3) return result;
  if (/invalid password/i.test(result.stderr)) {
    throw password ? new ToolError('wrongPassword', 'wrong password') : new ToolError('locked', 'password protected');
  }
  if (/not a PDF|can't find PDF header|unable to find trailer|startxref/i.test(result.stderr)) {
    throw new ToolError('notPdf', result.stderr.trim());
  }
  throw new ToolError('failed', result.stderr.trim() || `qpdf exited with code ${result.code}`);
}

async function qpdf(args) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'qpdf is not installed');
  return check(await runProgram(file, args));
}

// `job` is qpdf's JSON form of a command (see `qpdf --job-json-help`).
async function qpdfJob(job, { workDir, password } = {}) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'qpdf is not installed');
  return withPrivateFile(workDir, JSON.stringify(job), async (jobFile) =>
    check(await runProgram(file, [`--job-json-file=${jobFile}`]), password));
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
    result = password
      ? await qpdfJob({ inputFile: input, password, json: '2', jsonKey: ['pages', 'qpdf', 'encrypt'] }, { workDir, password })
      : await qpdf(['--json=2', '--json-key=pages', '--json-key=qpdf', '--json-key=encrypt', input], { workDir });
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

// pages: [[page, turn]] (1-based, in the new order). The turns apply to the
// output's pages, grouped by angle: --rotate=+90:1,4 turns output pages 1 and 4.
function organize(input, output, pages, workDir) {
  const turns = { 90: [], 180: [], 270: [] };
  pages.forEach(([, turn], i) => turns[turn]?.push(i + 1));
  const rotations = Object.entries(turns).filter(([, list]) => list.length).map(([angle, list]) => `--rotate=+${angle}:${list.join(',')}`);
  return qpdf(['--empty', '--pages', input, pages.map(([page]) => page).join(','), '--', ...rotations, output], { workDir });
}

// Lays the pages of `layer` over pages of `input`: page `from` of the layer
// on page `to` (qpdf page ranges, "1-z" for all). qpdf turns the layer to
// match each page's rotation, so a layer drawn at the page's shown size
// comes out upright.
const overlay = (input, layer, output, { to = '1-z', from = '1-z' } = {}, workDir) =>
  qpdf([input, '--overlay', layer, `--to=${to}`, `--from=${from}`, '--', output], { workDir });

const encrypt = (input, output, password, workDir) =>
  qpdfJob({ inputFile: input, outputFile: output, encrypt: { userPassword: password, ownerPassword: password, '256bit': {} } }, { workDir });

const decrypt = (input, output, password, workDir) =>
  qpdfJob({ inputFile: input, password, outputFile: output, decrypt: '' }, { workDir, password });

module.exports = {
  available: () => !!program(),
  info,
  merge,
  extract,
  rotate,
  organize,
  overlay,
  encrypt,
  decrypt,
};
