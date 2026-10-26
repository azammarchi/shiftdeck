// Installs the programs Shiftdeck's tools use, with the system's own package
// manager: Homebrew on macOS; apt, dnf, pacman or zypper on Linux; winget (or
// Chocolatey) on Windows. Only what's missing is installed; then it checks.
//
//   npm run setup              install what this system needs
//   npm run setup -- --all     also the engines macOS doesn't need (for testing)
//   npm run setup -- --dry-run show the commands without running them
const { spawnSync } = require('child_process');
const { findProgram } = require('../engines/run');
const { engines } = require('../engines');

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

const ENGINES = {
  qpdf: 'merging, splitting, rotating and AES-256 passwords',
  mutool: 'PDF to images (MuPDF)',
  imagemagick: 'converting images: PNG, JPEG, HEIC, TIFF, WebP...',
};

// On macOS, Apple's PDFKit already does the PDF work, so mutool isn't needed;
// qpdf adds strong passwords and ImageMagick converts images.
const wanted = isMac && !args.has('--all') ? ['qpdf', 'imagemagick'] : Object.keys(ENGINES);

// Package names per package manager, and how to install with it.
const MANAGERS = [
  { name: 'brew', packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick' }, install: (p) => [['brew', 'install', ...p]] },
  { name: 'apt-get', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick' }, install: (p) => [['apt-get', 'update'], ['apt-get', 'install', '-y', ...p]] },
  { name: 'dnf', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'ImageMagick' }, install: (p) => [['dnf', 'install', '-y', ...p]] },
  { name: 'pacman', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf-tools', imagemagick: 'imagemagick' }, install: (p) => [['pacman', '-S', '--needed', '--noconfirm', ...p]] },
  { name: 'zypper', sudo: true, packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'ImageMagick' }, install: (p) => [['zypper', 'install', '-y', ...p]] },
  {
    name: 'winget',
    packages: { qpdf: 'QPDF.QPDF', mutool: 'ArtifexSoftware.mutool', imagemagick: 'ImageMagick.ImageMagick' },
    install: (p) => p.map((id) => ['winget', 'install', '--id', id, '--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity']),
  },
  { name: 'choco', packages: { qpdf: 'qpdf', mutool: 'mupdf', imagemagick: 'imagemagick' }, install: (p) => [['choco', 'install', '-y', '--no-progress', ...p]] },
];

const MANUAL = {
  qpdf: 'https://github.com/qpdf/qpdf/releases',
  mutool: 'https://mupdf.com/releases',
  imagemagick: 'https://imagemagick.org/script/download.php',
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

function report() {
  const found = engines();
  console.log('');
  for (const name of Object.keys(ENGINES)) {
    const mark = found[name] ? '✓' : wanted.includes(name) ? '✗' : '–';
    console.log(`  ${mark} ${name.padEnd(12)} ${ENGINES[name]}`);
  }
  if (isMac) console.log(`  ${found.pdfkit ? '✓' : '✗'} ${'PDFKit'.padEnd(12)} built into macOS: every PDF tool`);
  return wanted.filter((name) => !found[name]);
}

function main() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 20) {
    console.error(`Shiftdeck needs Node.js 20 or newer; this is ${process.version}. Get it from https://nodejs.org`);
    process.exit(1);
  }

  console.log('Shiftdeck setup: checking the programs its tools use...');
  const missing = report();
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

  console.log(`\nInstalling ${missing.join(', ')} with ${manager.name}...`);
  const needsSudo = manager.sudo && typeof process.getuid === 'function' && process.getuid() !== 0;
  const sudo = needsSudo ? findProgram('sudo') : null;
  if (needsSudo && !sudo) console.log('(sudo not found: trying without it)');
  let ok = true;
  for (const command of manager.install(missing.map((name) => manager.packages[name]))) {
    const full = [command[0] === manager.name ? manager.program : command[0], ...command.slice(1)];
    if (!run(sudo ? [sudo, ...full] : full)) ok = false;
  }
  if (dryRun) return;

  const stillMissing = report();
  if (stillMissing.length) {
    console.error(`\nStill missing: ${stillMissing.join(', ')}.${ok ? '' : ` ${manager.name} reported an error above.`}`);
    console.error('Install them by hand, then run npm run setup again:');
    for (const name of stillMissing) console.error(`  ${name}: ${MANUAL[name]}`);
    process.exit(1);
  }
  console.log('\nAll set. Start Shiftdeck with: npm start');
}

main();
