// A minimal ZIP writer, in plain Node: one archive from a list of files,
// written straight to a stream. Each file is compressed with deflate unless
// that doesn't make it smaller (PNG, JPEG and most PDFs are already
// compressed), in which case it is stored as it is. Names are UTF-8.
// No ZIP64, so each file and the whole archive must stay under 4 GB.
const fsp = require('fs/promises');
const zlib = require('zlib');

const LIMIT = 0xffffffff;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time, as ZIP stores them (local time, 2-second steps).
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((Math.max(date.getFullYear(), 1980) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// Two files with the same name get " (2)", " (3)"... before the extension.
function uniqueNames(names) {
  const seen = new Set();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) {
      const dot = name.lastIndexOf('.');
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

// files: [{ path, name }]. `write(buffer)` may return a promise (to wait for
// the stream to drain). One file is in memory at a time.
async function writeZip(files, write, now = new Date()) {
  const { time, day } = dosDateTime(now);
  const names = uniqueNames(files.map((f) => f.name));
  const central = [];
  let offset = 0;
  const emit = async (buffer) => {
    await write(buffer);
    offset += buffer.length;
  };

  for (const [i, file] of files.entries()) {
    const data = await fsp.readFile(file.path);
    const deflated = zlib.deflateRawSync(data);
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const crc = crc32(data);
    const name = Buffer.from(names[i], 'utf8');
    if (data.length > LIMIT || offset + body.length > LIMIT) throw new Error('ZIP archives over 4 GB are not supported');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const headerOffset = offset;
    await emit(Buffer.concat([local, name]));
    await emit(body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by: 2.0
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(day, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(headerOffset, 42);
    central.push(Buffer.concat([entry, name]));
  }

  const directory = Buffer.concat(central);
  const directoryOffset = offset;
  await emit(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(directoryOffset, 16);
  await emit(end);
}

// Reads an archive written by writeZip back into { name: Buffer }, checking
// every CRC. Used by the tests.
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a ZIP archive');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('bad central directory');
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const body = buffer.subarray(start, start + size);
    const data = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    if (crc32(data) !== crc) throw new Error(`CRC mismatch in ${name}`);
    files[name] = data;
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

module.exports = { writeZip, readZip, crc32, uniqueNames };
