// Puts Shiftdeck on the desktop: an app to open with a double-click, and a
// way to send files to it from the file manager, so they arrive in the app
// already loaded. Only the system's own tools are used. Everything goes in
// the user's own folders (no administrator needed) and uninstall() takes it
// all away again.
//
//   macOS    ~/Applications/Shiftdeck.app, an AppleScript applet (osacompile)
//            that starts Shiftdeck and accepts files: Finder's "Open With",
//            or files dropped on its icon
//   Windows  a Start menu shortcut and a "Send to" shortcut (several files at
//            once), both running a small launcher script without a console
//   Linux    an application launcher (the menu, and "Open With" in file
//            managers) and a "Convert with Shiftdeck" script for Nautilus
//
// The launchers run this copy of Shiftdeck with the Node that installed them;
// after moving the folder or Node, run install-desktop again.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findProgram } = require('../engines/run');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'bin', 'shiftdeck.js');
const ICON = path.join(ROOT, 'desktop', 'icon.png');
const ICON_256 = path.join(ROOT, 'desktop', 'icon-256.png');
const NAME = 'Shiftdeck';
const BUNDLE_ID = 'io.github.azammarchi.shiftdeck';

// The kinds of file Shiftdeck's tools take, for Linux file managers.
const MIME_TYPES = [
  'application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp', 'image/tiff', 'image/gif', 'image/bmp',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-aiff',
  'video/mp4', 'video/quicktime', 'video/x-matroska', 'video/webm', 'video/x-msvideo',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'application/vnd.oasis.opendocument.text', 'application/rtf', 'text/plain', 'text/html', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.oasis.opendocument.presentation',
];

// Where things go, per system, under `home` (and Windows' AppData folders),
// so tests can install into a temporary folder.
function places({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return { app: path.join(home, 'Applications', `${NAME}.app`) };
  if (platform === 'win32') {
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return {
      folder: path.join(local, NAME),
      launcher: path.join(local, NAME, 'shiftdeck.vbs'),
      icon: path.join(local, NAME, 'shiftdeck.ico'),
      startMenu: path.join(roaming, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`),
      sendTo: path.join(roaming, 'Microsoft', 'Windows', 'SendTo', `${NAME}.lnk`),
    };
  }
  const data = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return {
    desktopFile: path.join(data, 'applications', 'shiftdeck.desktop'),
    nautilusScript: path.join(data, 'nautilus', 'scripts', 'Convert with Shiftdeck'),
  };
}

// --- macOS -----------------------------------------------------------------

// A string literal for AppleScript.
const appleString = (text) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function installMac({ app }, node) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-app-'));
  try {
    // Without files it starts Shiftdeck; with files (Open With, or dropped on
    // the icon) it opens them in it. Paths reach the shell quoted.
    const command = `quoted form of ${appleString(node)} & " " & quoted form of ${appleString(CLI)}`;
    const script = path.join(work, 'shiftdeck.applescript');
    fs.writeFileSync(script, [
      'on run',
      `\tdo shell script ${command} & " > /dev/null 2>&1 &"`,
      'end run',
      '',
      'on open theItems',
      `\tset theCommand to ${command} & " open"`,
      '\trepeat with theItem in theItems',
      '\t\tset theCommand to theCommand & " " & quoted form of POSIX path of theItem',
      '\tend repeat',
      '\tdo shell script theCommand & " > /dev/null 2>&1 &"',
      'end open',
      '',
    ].join('\n'));
    fs.rmSync(app, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(app), { recursive: true });
    execFileSync('osacompile', ['-o', app, script]);

    // Its own name and icon, and every kind of file in "Open With".
    const plist = path.join(app, 'Contents', 'Info.plist');
    const set = (key, type, value) => execFileSync('plutil', ['-replace', key, type, value, plist]);
    set('CFBundleIdentifier', '-string', BUNDLE_ID);
    set('CFBundleName', '-string', NAME);
    set('CFBundleDocumentTypes', '-json', JSON.stringify([{
      CFBundleTypeName: 'File', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['public.data', 'public.content'],
    }]));
    const iconset = path.join(work, 'Shiftdeck.iconset');
    fs.mkdirSync(iconset);
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(size), String(size), ICON, '--out', path.join(iconset, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(size * 2), String(size * 2), ICON, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
    }
    // The icon goes where the bundle says (an applet that takes files is a
    // "droplet"), and the asset catalogue that would take precedence over it
    // is dropped.
    const iconFile = execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(app, 'Contents', 'Resources', `${iconFile.replace(/\.icns$/, '')}.icns`)]);
    try {
      execFileSync('plutil', ['-remove', 'CFBundleIconName', plist], { stdio: 'ignore' });
    } catch {}
    fs.rmSync(path.join(app, 'Contents', 'Resources', 'Assets.car'), { force: true });
    // osacompile signs the app, and the changes above break that signature,
    // which stops it from starting on Apple silicon: sign it again, the same
    // way (ad hoc, for this Mac).
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' });

    // Tell Finder about it now rather than at its next scan.
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    if (fs.existsSync(lsregister)) {
      try {
        execFileSync(lsregister, ['-f', app], { stdio: 'ignore' });
      } catch {}
    }
    return [app];
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// --- Windows ---------------------------------------------------------------

// An .ico file holding one 256-pixel PNG, which Windows reads since Vista.
function writeIco(png, file) {
  const data = fs.readFileSync(png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(0, 6); // width 256
  header.writeUInt8(0, 7); // height 256
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(data.length, 14);
  header.writeUInt32LE(22, 18); // where the image starts
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

// A string literal for VBScript.
const vbString = (text) => `"${text.replace(/"/g, '""')}"`;

function installWindows(where, node) {
  fs.mkdirSync(where.folder, { recursive: true });
  writeIco(ICON_256, where.icon);
  // wscript runs this without a console window; files sent to the shortcut
  // arrive as its arguments.
  fs.writeFileSync(where.launcher, [
    "' Starts Shiftdeck without a console window; files given to it open in the app.",
    'Set shell = CreateObject("WScript.Shell")',
    `command = """" & ${vbString(node)} & """ """ & ${vbString(CLI)} & """"`,
    'If WScript.Arguments.Count > 0 Then',
    '  command = command & " open"',
    '  For Each item In WScript.Arguments',
    '    command = command & " """ & item & """"',
    '  Next',
    'End If',
    'shell.Run command, 0, False',
    '',
  ].join('\r\n'));
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  // Shortcuts are made through Windows' own scripting object; the values go
  // in through environment variables, never into the script's text.
  const powershell = findProgram('powershell') || 'powershell.exe';
  for (const link of [where.startMenu, where.sendTo]) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      '$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:SD_LINK); $s.TargetPath = $env:SD_TARGET; $s.Arguments = $env:SD_ARGS; $s.IconLocation = $env:SD_ICON; $s.Description = $env:SD_NAME; $s.WorkingDirectory = $env:SD_DIR; $s.Save()'], {
      env: { ...process.env, SD_LINK: link, SD_TARGET: wscript, SD_ARGS: `"${where.launcher}"`, SD_ICON: where.icon, SD_NAME: NAME, SD_DIR: ROOT },
      windowsHide: true,
    });
  }
  return [where.startMenu, where.sendTo, where.launcher, where.icon];
}

// --- Linux -----------------------------------------------------------------

// An argument in a .desktop file's Exec line: quoted, with the characters
// the specification reserves escaped (and backslashes doubled again, since
// the value is itself a string).
const execArg = (text) => `"${text.replace(/[\\"`$]/g, (c) => `\\\\${c}`)}"`;
// An argument for sh.
const shArg = (text) => `'${text.replace(/'/g, "'\\''")}'`;

function installLinux({ desktopFile, nautilusScript }, node) {
  fs.mkdirSync(path.dirname(desktopFile), { recursive: true });
  fs.writeFileSync(desktopFile, [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${NAME}`,
    'Comment=Convert and edit files on your computer',
    `Exec=${execArg(node)} ${execArg(CLI)} open %F`,
    `Icon=${ICON}`,
    'Terminal=false',
    'Categories=Utility;Office;Graphics;AudioVideo;',
    `MimeType=${MIME_TYPES.join(';')};`,
    'StartupNotify=false',
    '',
  ].join('\n'));
  fs.mkdirSync(path.dirname(nautilusScript), { recursive: true });
  fs.writeFileSync(nautilusScript, [
    '#!/bin/sh',
    '# Nautilus passes the selected files as arguments.',
    `exec ${shArg(node)} ${shArg(CLI)} open "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  const updater = findProgram('update-desktop-database');
  if (updater) {
    try {
      execFileSync(updater, [path.dirname(desktopFile)], { stdio: 'ignore' });
    } catch {}
  }
  return [desktopFile, nautilusScript];
}

// Installs the launchers and returns the paths it made.
function install(options = {}) {
  const platform = options.platform || process.platform;
  const node = options.node || process.execPath;
  const where = places(options);
  if (platform === 'darwin') return installMac(where, node);
  if (platform === 'win32') return installWindows(where, node);
  return installLinux(where, node);
}

// Removes whatever install() made; returns the paths it removed.
function uninstall(options = {}) {
  const where = places(options);
  const removed = [];
  for (const target of Object.values(where)) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    }
  }
  return removed;
}

module.exports = { install, uninstall, places, writeIco };
