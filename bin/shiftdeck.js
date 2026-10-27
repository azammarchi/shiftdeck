#!/usr/bin/env node
// The shiftdeck command: the app's tools from a terminal, and a watched
// folder that converts whatever lands in it. Same engines as the app.
//
//   shiftdeck                         start the app (like npm start)
//   shiftdeck tools                   list the tools and whether they work here
//   shiftdeck <tool> [options] files  run a tool, results in --out (default: here)
//   shiftdeck watch <folder> --tool <tool> [options]
//                                     convert every file that arrives in <folder>
//   shiftdeck open files              start the app with files already loaded
//   shiftdeck install-desktop         launcher and file-manager integration
//   shiftdeck uninstall-desktop       ...and away again
//   shiftdeck help                    this text, with each tool's options
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { TOOLS, runTool, engines } = require('../engines');

// Options each tool takes, for help: --name <values>.
const OPTIONS = {
  merge: '',
  split: '--ranges "1-3,4"',
  organize: '--pages "3,1,2:90"   (pages in the new order; :90, :180 or :270 turns one)',
  'pdf-to-images': '--format png|jpeg  --dpi 150',
  'images-to-pdf': '--page-size a4|letter|original',
  'documents-to-pdf': '',
  'convert-images': '--format jpeg|png|webp|tiff|heic  --quality 85  --max-size 2000  --keep-metadata',
  'convert-audio': '--format mp3|m4a|ogg|opus|flac|wav  --bitrate 192',
  'convert-video': '--format mp4|webm|mov|gif  --quality high|medium|small  --height 720  --remove-audio',
  'page-numbers': '--template "Page {n} of {total}"  --position bottom-center  --start 1  --size 11  --skip-first',
  sign: '--signature signature.png  --page 1  --position bottom-right  --width 150',
  watermark: '--text DRAFT  --style diagonal|horizontal  --opacity 20',
  compress: '--level smaller|smallest|lossless',
  rotate: '--degrees 90|180|270',
  protect: '--password …  (or the SHIFTDECK_PASSWORD environment variable)',
  unlock: '--password …  (or the SHIFTDECK_PASSWORD environment variable)',
};

// A path as short as it can be said: relative when it's under the current
// folder, in full otherwise.
const shown = (file) => {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
};

const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// --name value, --flag, --no-flag; everything else is a file. Values stay
// strings: the tools check and convert them, as they do for the app.
function parse(args) {
  const options = {};
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      files.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split(/=(.*)/s);
    if (name.startsWith('no-')) options[camel(name.slice(3))] = false;
    else if (inline !== undefined) options[camel(name)] = inline;
    else if (i + 1 < args.length && !args[i + 1].startsWith('--')) options[camel(name)] = args[++i];
    else options[camel(name)] = true;
  }
  return { options, files };
}

// The app sends some options in a richer form; the command line takes them
// as text and files.
async function toolOptions(tool, options) {
  const result = { ...options };
  delete result.out;
  delete result.tool;
  if (tool === 'convert-images') {
    result.stripMetadata = !result.keepMetadata;
    delete result.keepMetadata;
  }
  if (tool === 'organize' && typeof result.pages === 'string') {
    result.pages = result.pages.split(',').map((part) => {
      const [page, turn] = part.trim().split(':');
      return { page: Number(page), turn: Number(turn || 0) };
    });
  }
  if (tool === 'sign' && typeof result.signature === 'string') {
    const png = await fsp.readFile(result.signature);
    result.signature = `data:image/png;base64,${png.toString('base64')}`;
  }
  if ((tool === 'protect' || tool === 'unlock') && !result.password && process.env.SHIFTDECK_PASSWORD) {
    result.password = process.env.SHIFTDECK_PASSWORD;
  }
  return result;
}

// Copies a result into `dir` without overwriting: "name (2).ext" when taken.
async function deliver(file, dir) {
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  for (let n = 1; ; n++) {
    const target = path.join(dir, n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`);
    try {
      await fsp.copyFile(file, target, fs.constants.COPYFILE_EXCL);
      return target;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
}

function progressPrinter(label) {
  if (!process.stderr.isTTY) return undefined;
  let last = -1;
  return (fraction) => {
    const percent = Math.floor(fraction * 100);
    if (percent === last) return;
    last = percent;
    process.stderr.write(`\r${label} ${percent}%`);
    if (percent === 100) process.stderr.write('\n');
  };
}

// Runs a tool on files and copies the results into `outDir`. Returns their
// paths. The tool works in a temporary folder that is removed afterwards.
async function run(tool, files, options, outDir, { signal } = {}) {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'shiftdeck-cli-'));
  try {
    const inputs = files.map((file) => ({ path: path.resolve(file), name: path.basename(file) }));
    const result = await runTool(tool, inputs, await toolOptions(tool, options), work, { signal, onProgress: progressPrinter(tool) });
    await fsp.mkdir(outDir, { recursive: true });
    const delivered = [];
    for (const output of result.outputs) delivered.push(await deliver(output, outDir));
    for (const warning of result.warnings) console.error(`note: ${warning === 'weakEncryption' ? 'RC4 128-bit encryption only: install qpdf for AES-256' : warning === 'notSmaller' ? 'already as small as it gets; the copy is unchanged' : warning}`);
    return delivered;
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }
}

function listTools() {
  const found = engines();
  console.log('Engines:', Object.entries(found).map(([name, ok]) => `${name} ${ok ? 'yes' : 'no'}`).join(', '));
  for (const [name, tool] of Object.entries(TOOLS)) {
    const missing = tool.needs();
    console.log(`  ${missing.length ? '✗' : '✓'} ${name.padEnd(18)} ${missing.length ? `needs ${missing.join(', ')} (npm run setup)` : tool.accepts.join(' ')}`);
  }
}

function help() {
  console.log(`Shiftdeck: convert and edit files on this computer.

  shiftdeck                          start the app in your browser
  shiftdeck tools                    which tools work on this computer
  shiftdeck <tool> [options] files   run a tool; results go to --out <folder> (default: here)
  shiftdeck watch <folder> --tool <tool> [options]
                                     convert every file that arrives in <folder>,
                                     into <folder>/converted unless --out says otherwise
  shiftdeck open files               start the app with these files already loaded
  shiftdeck install-desktop          an app to open with a double-click, and a way to
                                     send files to Shiftdeck from your file manager
  shiftdeck uninstall-desktop        take them away again

Tools and their options:`);
  for (const [name, options] of Object.entries(OPTIONS)) console.log(`  ${name.padEnd(18)} ${options}`);
}

// ---------------------------------------------------------------------------
// Watched folder: new files are converted one at a time, once they've
// stopped growing (still being copied or downloaded otherwise). Files that
// were there before, and the results, are left alone.
// ---------------------------------------------------------------------------
async function watch(folder, options) {
  const tool = options.tool;
  if (!TOOLS[tool]) throw Object.assign(new Error(`unknown tool ${tool || '(none)'}: use --tool, see shiftdeck help`), { code: 'badTool' });
  if (TOOLS[tool].mode === 'combine' || TOOLS[tool].minFiles > 1) throw new Error(`${tool} combines several files, so it can't run on each new file`);
  const root = path.resolve(folder);
  const outDir = path.resolve(options.out || path.join(root, 'converted'));
  await fsp.mkdir(outDir, { recursive: true });
  const seen = new Set(await fsp.readdir(root));
  const queue = [];
  let busy = false;

  const settled = async (file) => {
    let size = -1;
    for (;;) {
      const now = (await fsp.stat(file)).size;
      if (now === size) return;
      size = now;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  const next = async () => {
    if (busy || !queue.length) return;
    busy = true;
    const file = queue.shift();
    try {
      await settled(file);
      const results = await run(tool, [file], options, outDir);
      for (const result of results) console.log(`${path.basename(file)} → ${shown(result)}`);
    } catch (err) {
      console.error(`${path.basename(file)}: ${err.message}`);
    } finally {
      busy = false;
      next();
    }
  };

  const look = async () => {
    for (const name of await fsp.readdir(root)) {
      if (seen.has(name)) continue;
      seen.add(name);
      const file = path.join(root, name);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat?.isFile() || name.startsWith('.') || !TOOLS[tool].accepts.includes(path.extname(name).toLowerCase())) continue;
      queue.push(file);
    }
    next();
  };

  console.log(`Watching ${root} with ${tool}; results go to ${outDir}. Ctrl+C to stop.`);
  // fs.watch says something changed; looking at the folder says what.
  fs.watch(root, () => look().catch((err) => console.error(err.message)));
  // And a look every few seconds, for file systems where fs.watch is quiet.
  setInterval(() => look().catch(() => {}), 3000);
  // So tests (and scripts) know when it's ready.
  if (process.env.SHIFTDECK_WATCH_READY) console.log('ready');
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command) {
    require('../server');
    return;
  }
  // Starts the app with files already loaded (the desktop launchers use it).
  if (command === 'open') {
    const files = rest.filter((arg) => !arg.startsWith('--')).map((file) => path.resolve(file));
    process.env.SHIFTDECK_OPEN = JSON.stringify(files);
    require('../server');
    return;
  }
  if (command === 'install-desktop' || command === 'uninstall-desktop') {
    const desktop = require('../lib/desktop');
    // npm run desktop -- --remove is the same as uninstall-desktop.
    const removing = command === 'uninstall-desktop' || rest.includes('--remove');
    const paths = removing ? desktop.uninstall() : desktop.install();
    for (const made of paths) console.log(made);
    console.log(!removing
      ? '\nShiftdeck is on your desktop: open it like any app, or send files to it from your file manager.'
      : paths.length ? '\nRemoved.' : 'Nothing to remove.');
    return;
  }
  // An installed ffmpeg only counts once it has been seen to start.
  await require('../engines/ffmpeg').capabilities();
  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'tools') return listTools();
  const { options, files } = parse(rest);
  if (command === 'watch') {
    if (files.length !== 1) throw new Error('watch takes one folder: shiftdeck watch <folder> --tool <tool>');
    return watch(files[0], options);
  }
  if (!TOOLS[command]) throw new Error(`unknown tool or command "${command}": see shiftdeck help`);
  if (!files.length) throw new Error(`no files given: shiftdeck ${command} [options] files`);
  const results = await run(command, files, options, path.resolve(options.out || '.'));
  for (const result of results) console.log(shown(result));
}

main().catch((err) => {
  console.error(`shiftdeck: ${err.message}`);
  process.exit(err.code === 'noEngine' ? 3 : 1);
});
