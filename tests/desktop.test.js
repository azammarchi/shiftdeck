// Desktop integration: what install-desktop makes on this system (in a
// temporary home, never the real one), that uninstall-desktop takes it all
// away, and that `shiftdeck open` starts the app with the files loaded.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const desktop = require('../lib/desktop');
const { makeSampleFiles, sample } = require('./sample-files');

const CLI = path.join(__dirname, '..', 'bin', 'shiftdeck.js');
const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-home-'));
// Windows keeps these in AppData; the tests point it at the temporary home.
const env = (dir) => ({ APPDATA: path.join(dir, 'Roaming'), LOCALAPPDATA: path.join(dir, 'Local'), XDG_DATA_HOME: path.join(dir, 'share') });

before(makeSampleFiles);

test('macOS: an app that starts Shiftdeck and opens files, signed and with its icon', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
  const dir = home();
  const [app] = desktop.install({ home: dir });
  assert.equal(app, path.join(dir, 'Applications', 'Shiftdeck.app'));
  const plist = path.join(app, 'Contents', 'Info.plist');
  // Strings come out raw; plutil only writes lists and dictionaries as JSON.
  const read = (key, format = 'raw') => execFileSync('plutil', ['-extract', key, format, '-o', '-', plist], { encoding: 'utf8' }).trim();
  assert.equal(read('CFBundleIdentifier'), 'io.github.azammarchi.shiftdeck');
  assert.deepEqual(JSON.parse(read('CFBundleDocumentTypes', 'json'))[0].LSItemContentTypes, ['public.data', 'public.content']);
  const icon = read('CFBundleIconFile');
  assert.ok(fs.statSync(path.join(app, 'Contents', 'Resources', `${icon}.icns`)).size > 10000);
  const script = execFileSync('osadecompile', [path.join(app, 'Contents', 'Resources', 'Scripts', 'main.scpt')], { encoding: 'utf8' });
  assert.match(script, /on open theItems/);
  assert.ok(script.includes(CLI));
  // A broken signature would stop it from starting on Apple silicon.
  execFileSync('codesign', ['--verify', app]);
  assert.deepEqual(desktop.uninstall({ home: dir }), [app]);
  assert.equal(fs.existsSync(app), false);
});

test('Linux: a launcher for the menu and "Open With", and a Nautilus script', { skip: (process.platform === 'darwin' || process.platform === 'win32') && 'Linux only' }, () => {
  const dir = home();
  const made = desktop.install({ home: dir, env: env(dir) });
  const [launcher, script] = made;
  const entry = fs.readFileSync(launcher, 'utf8');
  assert.match(entry, /^Exec=".+" ".+shiftdeck\.js" open %F$/m);
  assert.match(entry, /^MimeType=.*application\/pdf;.*image\/heic;/m);
  assert.match(entry, /^Icon=.+icon\.png$/m);
  assert.ok(fs.statSync(script).mode & 0o100, 'the Nautilus script can run');
  assert.match(fs.readFileSync(script, 'utf8'), /open "\$@"/);
  assert.deepEqual(desktop.uninstall({ home: dir, env: env(dir) }).sort(), made.sort());
});

test('Windows: Start menu and Send to shortcuts, a quiet launcher and an icon', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const dir = home();
  const made = desktop.install({ home: dir, env: env(dir) });
  for (const file of made) assert.ok(fs.existsSync(file), file);
  const where = desktop.places({ home: dir, env: env(dir) });
  const ico = fs.readFileSync(where.icon);
  assert.equal(ico.readUInt16LE(2), 1); // an icon
  assert.equal(ico.subarray(22, 26).toString('latin1'), '\x89PNG');
  assert.match(fs.readFileSync(where.launcher, 'utf8'), /shell\.Run command, 0, False/);
  desktop.uninstall({ home: dir, env: env(dir) });
  for (const file of made) assert.equal(fs.existsSync(file), false, file);
});

test('a .ico file holds the PNG as Windows expects', () => {
  const file = path.join(home(), 'test.ico');
  desktop.writeIco(path.join(__dirname, '..', 'desktop', 'icon-256.png'), file);
  const ico = fs.readFileSync(file);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2), ico.readUInt16LE(4)], [0, 1, 1]);
  assert.equal(ico.readUInt32LE(14), ico.length - 22);
});

test('shiftdeck open starts the app with the files already loaded, once', async () => {
  const child = spawn(process.execPath, [CLI, 'open', sample('two-pages.pdf'), sample('p1.png'), path.join(os.tmpdir(), 'not-there.pdf')], {
    env: { ...process.env, PORT: '0', NO_OPEN: '1', KEEP_RUNNING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const base = await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = /localhost:(\d+)/.exec(output);
        if (match) resolve(`http://127.0.0.1:${match[1]}`);
      });
      child.on('exit', (code) => reject(new Error(`exited with ${code}`)));
    });
    const first = await (await fetch(`${base}/api/opened`)).json();
    assert.deepEqual(first.files.map((f) => f.name), ['two-pages.pdf', 'p1.png']);
    assert.deepEqual((await (await fetch(`${base}/api/opened`)).json()).files, [], 'only handed over once');
    // They are real uploads: a tool can use them straight away.
    const response = await fetch(`${base}/api/tools/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: [first.files[0].id], options: { degrees: 90 } }),
    });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).outputs[0].name, 'two-pages-rotated.pdf');
  } finally {
    child.kill();
  }
});
