// The ZIP writer behind "Download all": what it writes reads back intact, and
// the archive opens with the system's own unzip tools where there are some.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { writeZip, readZip, crc32, uniqueNames } = require('../lib/zip');
const { findProgram } = require('../engines/run');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-zip-'));
const file = (name, data) => {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, data);
  return filePath;
};

async function zipOf(files) {
  const chunks = [];
  await writeZip(files, (buffer) => chunks.push(buffer), new Date(2026, 9, 26, 12, 0, 0));
  return Buffer.concat(chunks);
}

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('files come back byte for byte, compressed or stored', async () => {
  const text = Buffer.from('Shiftdeck '.repeat(2000)); // compresses well
  const noise = crypto.randomBytes(5000); // doesn't, so it's stored
  const zip = await zipOf([
    { path: file('text.txt', text), name: 'text.txt' },
    { path: file('noise.bin', noise), name: 'noise.bin' },
    { path: file('empty.txt', ''), name: 'empty.txt' },
  ]);
  const back = readZip(zip);
  assert.deepEqual(Object.keys(back), ['text.txt', 'noise.bin', 'empty.txt']);
  assert.ok(back['text.txt'].equals(text));
  assert.ok(back['noise.bin'].equals(noise));
  assert.equal(back['empty.txt'].length, 0);
  assert.ok(zip.length < text.length, 'text was compressed');
});

test('names keep accents, and equal names get a number', async () => {
  assert.deepEqual(uniqueNames(['a.pdf', 'A.pdf', 'a.pdf', 'b']), ['a.pdf', 'A (2).pdf', 'a (3).pdf', 'b']);
  const zip = await zipOf([
    { path: file('one.pdf', '1'), name: 'Città è.pdf' },
    { path: file('two.pdf', '2'), name: 'Città è.pdf' },
  ]);
  assert.deepEqual(Object.keys(readZip(zip)), ['Città è.pdf', 'Città è (2).pdf']);
});

test('the system\'s unzip tools open it', { skip: !findProgram('unzip') && !findProgram('python3') && !findProgram('tar') && 'no unzip tool here' }, async () => {
  const zip = file('test.zip', await zipOf([
    { path: file('a.txt', 'hello'.repeat(100)), name: 'a.txt' },
    { path: file('b.txt', 'world'), name: 'folder-less name è.txt' },
  ]));
  if (findProgram('unzip')) {
    assert.match(execFileSync(findProgram('unzip'), ['-t', zip], { encoding: 'utf8' }), /No errors detected/);
  } else if (findProgram('python3')) {
    execFileSync(findProgram('python3'), ['-c', 'import sys, zipfile; assert zipfile.ZipFile(sys.argv[1]).testzip() is None', zip]);
  } else {
    // Windows' tar (bsdtar) reads ZIP archives.
    assert.match(execFileSync(findProgram('tar'), ['-tf', zip], { encoding: 'utf8' }), /a\.txt/);
  }
});
