// Installs the programs Shiftdeck's tools use, with the system's own package
// manager: Homebrew on macOS; apt, dnf, pacman or zypper on Linux; winget (or
// Chocolatey) on Windows. Only what's missing is installed; then it checks.
//
//   npm run setup              install what this system needs
//   npm run setup -- --all     also the engines macOS doesn't need (for testing)
//   npm run setup -- --dry-run show the commands without running them
//   npm run setup -- --no-documents  skip LibreOffice (documents to PDF), a large download
const { spawnSync } = require('child_process');
const { findProgram } = require('../engines/run');
const { engines } = require('../engines');
const ffmpeg = require('../engines/ffmpeg');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const ENGINES = {
  qpdf: 'merging, splitting, rotating and AES-256 passwords',
  mutool: 'PDF to images (MuPDF)',
  imagemagick: 'converting images: PNG, JPEG, HEIC, TIFF, WebP...',
  ffmpeg: 'converting audio and video: MP3, M4A, WAV, MP4, WebM, GIF...',
  libreoffice: 'documents to PDF: Word, Excel, PowerPoint, OpenDocument... (a large download)',
};

// On macOS, Apple's PDFKit already does the PDF work, so mutool isn't needed.
// LibreOffice is large (several hundred MB): --no-documents leaves it out.
const wanted = (isMac && !args.has('--all') ? ['qpdf', 'imagemagick', 'ffmpeg', 'libreoffice'] : Object.keys(ENGINES))
  .filter((name) => !(name === 'libreoffice' && args.has('--no-documents')));

// Package names per package manager, and how to install with it.
const MANAGERS = [
  // An engine that is installed but doesn't start (a library it needs was
  // updated) is reinstalled: a plain `brew install` would do nothing.
  // LibreOffice comes as a Homebrew cask (an app), installed on its own.
  {
    name: 'brew',
    packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick', ffmpeg: 'ffmpeg', libreoffice: '--cask libreoffice' },
    install: (p, broken) => {
      const casks = p.filter((name) => name.startsWith('--cask ')).map((name) => name.slice(7));
      const formulas = p.filter((name) => !name.startsWith('--cask '));
      return [
        ...(formulas.length ? [['brew', 'install', ...formulas]] : []),
        ...(casks.length ? [['brew', 'install', '--cask', ...casks]] : []),
        ...(broken.length ? [['brew', 'reinstall', ...broken]] : []),
      ];
    },
  },
  { name: 'apt-get', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick', ffmpeg: 'ffmpeg', libreoffice: 'libreoffice-nogui' }, install: (p, broken) => [['apt-get', 'update'], ['apt-get', 'install', '-y', ...(broken.length ? ['--reinstall'] : []), ...p, ...broken]] },
  { name: 'dnf', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'ImageMagick', ffmpeg: 'ffmpeg-free', libreoffice: 'libreoffice' }, install: (p, broken) => [['dnf', 'install', '-y', ...p], ...(broken.length ? [['dnf', 'reinstall', '-y', ...broken]] : [])] },
  { name: 'pacman', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick', ffmpeg: 'ffmpeg', libreoffice: 'libreoffice-fresh' }, install: (p, broken) => [['pacman', '-S', '--noconfirm', ...p, ...broken]] },
  { name: 'zypper', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'ImageMagick', ffmpeg: 'ffmpeg', libreoffice: 'libreoffice' }, install: (p, broken) => [['zypper', 'install', '-y', ...(broken.length ? ['--force'] : []), ...p, ...broken]] },
  {
    name: 'winget',
    packages: { qpdf: 'QPDF.QPDF', mutool: 'ArtifexSoftware.mutool', imagemagick: 'ImageMagick.ImageMagick', ffmpeg: 'Gyan.FFmpeg', libreoffice: 'TheDocumentFoundation.LibreOffice' },
    install: (p, broken) => [...p, ...broken].map((id) => ['winget', 'install', '--id', id, '--exact', '--silent', '--force', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']),
  },
  { name: 'choco', packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'imagemagick', ffmpeg: 'ffmpeg', libreoffice: 'libreoffice-fresh' }, install: (p, broken) => [['choco', 'install', '-y', '--no-progress', ...(broken.length ? ['--force'] : []), ...p, ...broken]] },
];

const MANUAL = {
  qpdf: 'https://github.com/qpdf/qpdf/releases',
  mutool: 'https://mupdf.com/releases',
  imagemagick: 'https://imagemagick.org/script/download.php',
  ffmpeg: 'https://ffmpeg.org/download.html',
  libreoffice: 'https://www.libreoffice.org/download/',
};

function pickManager() {
  const order = isMac ? ['brew'] : isWindows ? ['winget', 'choco'] : ['apt-get', 'dnf', 'pacman', 'zypper', 'brew'];
  for (const name of order) {
    const program = findProgram(name);
    if (program) return { ...MANAGERS.find((m) => m.name === name), program };
  }
  return null;
}

function run(command) {
  console.log(`\n$ ${command.join(' ')}`);
  if (dryRun) return true;
  const [program, ...rest] = command;
  const result = spawnSync(program, rest, { stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  return result.status === 0;
}

// ffmpeg is only counted once it has been seen to start.
async function report() {
  ffmpeg.forget();
  await ffmpeg.capabilities();
  const found = engines();
  console.log('');
  for (const name of Object.keys(ENGINES)) {
    const mark = found[name] ? '✓' : wanted.includes(name) ? '✗' : '–';
    const note = !found[name] && findProgram(name) ? ' (installed, but it doesn\'t start)' : '';
    console.log(`  ${mark} ${name.padEnd(12)} ${ENGINES[name]}${note}`);
  }
  if (isMac) console.log(`  ${found.pdfkit ? '✓' : '✗'} ${'PDFKit'.padEnd(12)} built into macOS: every PDF tool`);
  return wanted.filter((name) => !found[name]);
}

async function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    console.error(`Shiftdeck needs Node.js 20 or newer; this is ${process.version}. Get it from https://nodejs.org`);
    process.exit(1);
  }

  console.log('Shiftdeck setup: checking the programs its tools use...');
  const missing = await report();
  if (!missing.length) {
    console.log('\nEverything is installed. Start Shiftdeck with: npm start');
    return;
  }

  const manager = pickManager();
  if (!manager) {
    console.error(`\nNo supported package manager found. Install ${missing.join(', ')} by hand:`);
    for (const name of missing) console.error(`  ${name}: ${MANUAL[name]}`);
    process.exit(1);
  }

  // Installed but not starting: reinstalled rather than installed.
  const broken = missing.filter((name) => findProgram(name));
  const absent = missing.filter((name) => !broken.includes(name));
  console.log(`\nInstalling ${missing.join(', ')} with ${manager.name}...`);
  const needsSudo = manager.sudo && typeof process.getuid === 'function' && process.getuid() !== 0;
  const sudo = needsSudo ? findProgram('sudo') : null;
  if (needsSudo && !sudo) console.log('(sudo not found: trying without it)');
  let ok = true;
  for (const command of manager.install(absent.map((name) => manager.packages[name]), broken.map((name) => manager.packages[name]))) {
    const full = [command[0] === manager.name ? manager.program : command[0], ...command.slice(1)];
    if (run(sudo ? [sudo, ...full] : full)) continue;
    // Homebrew may know an old version whose download is gone (404): update
    // what it knows and try once more.
    if (manager.name === 'brew' && run([manager.program, 'update']) && run(full)) continue;
    ok = false;
  }
  if (dryRun) return;

  const stillMissing = await report();
  if (stillMissing.length) {
    console.error(`\nStill missing: ${stillMissing.join(', ')}.${ok ? '' : ` ${manager.name} reported an error above.`}`);
    console.error('Install them by hand, then run npm run setup again:');
    for (const name of stillMissing) console.error(`  ${name}: ${MANUAL[name]}`);
    process.exit(1);
  }
  console.log('\nAll set. Start Shiftdeck with: npm start');
}

main();
