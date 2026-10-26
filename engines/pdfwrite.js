// A minimal PDF writer: one image per page, nothing else. Images go in
// losslessly: JPEG files as they are (DCTDecode), everything else as RGB
// pixels compressed with zlib (FlateDecode). Pure Node, no engine needed.
const fs = require('fs');
const zlib = require('zlib');

// Width, height and number of color components from a JPEG's frame header.
function jpegFrame(buffer) {
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    const length = buffer.readUInt16BE(i + 2);
    // Start-of-frame markers: C0-CF, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7), components: buffer[i + 9] };
    }
    i += 2 + length;
  }
  return null;
}

const num = (n) => String(Math.round(n * 100) / 100);

// pages: [{ width, height, image: { width, height, jpeg?: Buffer, components?, rgb?: Buffer }, box: [x, y, w, h] }]
// Written as it goes, so only one page's image is in memory at a time when
// `pages` is an async iterable.
async function writePdf(output, pages) {
  const fd = fs.openSync(output, 'w');
  let offset = 0;
  const offsets = [];
  const write = (data) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
    fs.writeSync(fd, buffer);
    offset += buffer.length;
  };
  const object = (id, body, stream) => {
    offsets[id] = offset;
    write(`${id} 0 obj\n${body}\n`);
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  };

  try {
    write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    // Objects 1 (catalog) and 2 (page tree) are written last, once the pages
    // are known; each page takes three ids: page, contents, image.
    const kids = [];
    let next = 3;
    for await (const page of pages) {
      const [pageId, contentsId, imageId] = [next, next + 1, next + 2];
      next += 3;
      const { image } = page;
      let filter;
      let colorSpace;
      let data;
      if (image.jpeg) {
        filter = '/DCTDecode';
        colorSpace = image.components === 1 ? '/DeviceGray' : '/DeviceRGB';
        data = image.jpeg;
      } else {
        filter = '/FlateDecode';
        colorSpace = '/DeviceRGB';
        data = zlib.deflateSync(image.rgb);
      }
      object(imageId, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>`, data);
      const [x, y, w, h] = page.box;
      const contents = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`;
      object(contentsId, `<< /Length ${contents.length} >>`, contents);
      object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`);
      kids.push(`${pageId} 0 R`);
    }
    object(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');

    const xref = offset;
    write(`xref\n0 ${next}\n0000000000 65535 f \n`);
    for (let id = 1; id < next; id++) write(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    write(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { writePdf, jpegFrame };
