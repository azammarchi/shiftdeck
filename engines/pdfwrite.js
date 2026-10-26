// A minimal PDF writer, pure Node: pages with images and lines of text on
// them, nothing else. It makes the PDFs of "Images to PDF" and the layers
// that page numbers and signatures are stamped from.
//
// Images go in losslessly: JPEG files as they are (DCTDecode), everything
// else as RGB pixels compressed with zlib (FlateDecode), with an optional
// alpha plane as a soft mask, so transparent parts stay transparent. Text
// uses Helvetica, one of the fonts every PDF reader has built in, so no font
// is embedded.
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

// Helvetica's character widths (in 1/1000 of the font size) for the
// printable ASCII characters, from its standard font metrics, starting at
// the space (32). Other characters count as 556, the width of a digit.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

function textWidth(text, size) {
  let units = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
  }
  return (units * size) / 1000;
}

// Typographic characters WinAnsi has outside Latin-1, and where.
const WIN_ANSI_EXTRA = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

// A PDF string in WinAnsi encoding (Latin-1 covers accented letters such as
// à or é, plus dashes, curly quotes and €); anything else becomes "?".
function pdfString(text) {
  let out = '(';
  for (const char of text) {
    const code = WIN_ANSI_EXTRA[char] ?? char.codePointAt(0);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code >= 32 && code <= 126) out += char;
    else if (code >= 0x80 && code <= 255) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return `${out})`;
}

// pages: [{ width, height, draw: [item] }], or async iterable of them, where
// an item is one of:
//   { image: { width, height, jpeg?, components?, rgb?, alpha? }, box: [x, y, w, h] }
//   { text, x, y, size, color?: [r, g, b] (0-1), angle?: degrees, opacity?: 0-1 }
//     (x, y is where the text starts, on its baseline; it turns around that point)
// For "Images to PDF", { width, height, image, box } is the same as one image
// item. Written as it goes, so only one page's images are in memory at a time.
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
    // Objects 1 (catalog), 2 (page tree) and 3 (the font) are written last,
    // once the pages are known.
    const kids = [];
    let next = 4;
    for await (const page of pages) {
      const items = page.draw || [{ image: page.image, box: page.box }];
      const xObjects = [];
      const ops = [];
      let usesFont = false;
      const states = [];
      for (const item of items) {
        if (item.image) {
          const { image } = item;
          const imageId = next++;
          let smask = '';
          if (image.alpha) {
            const maskId = next++;
            const mask = zlib.deflateSync(image.alpha);
            object(maskId, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${mask.length} >>`, mask);
            smask = ` /SMask ${maskId} 0 R`;
          }
          const jpeg = !!image.jpeg;
          const data = jpeg ? image.jpeg : zlib.deflateSync(image.rgb);
          const colorSpace = jpeg && image.components === 1 ? '/DeviceGray' : '/DeviceRGB';
          object(imageId, `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${jpeg ? '/DCTDecode' : '/FlateDecode'}${smask} /Length ${data.length} >>`, data);
          const name = `/Im${xObjects.length}`;
          xObjects.push(`${name} ${imageId} 0 R`);
          const [x, y, w, h] = item.box;
          ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm ${name} Do Q`);
        } else if (item.text !== undefined) {
          usesFont = true;
          const [r, g, b] = item.color || [0, 0, 0];
          const radians = ((item.angle || 0) * Math.PI) / 180;
          const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
          // A graphics state with the opacity, only when it isn't 1.
          let state = '';
          if (item.opacity !== undefined && item.opacity < 1) {
            const name = `/GS${states.length}`;
            states.push(`${name} << /Type /ExtGState /ca ${num(item.opacity)} /CA ${num(item.opacity)} >>`);
            state = `${name} gs `;
          }
          ops.push(`q ${state}BT ${num(r)} ${num(g)} ${num(b)} rg /F1 ${num(item.size)} Tf ${cos.toFixed(4)} ${sin.toFixed(4)} ${(-sin).toFixed(4)} ${cos.toFixed(4)} ${num(item.x)} ${num(item.y)} Tm ${pdfString(item.text)} Tj ET Q`);
        }
      }
      const [pageId, contentsId] = [next++, next++];
      const contents = ops.join('\n');
      object(contentsId, `<< /Length ${contents.length} >>`, contents);
      const resources = [
        xObjects.length ? `/XObject << ${xObjects.join(' ')} >>` : '',
        usesFont ? '/Font << /F1 3 0 R >>' : '',
        states.length ? `/ExtGState << ${states.join(' ')} >>` : '',
      ].filter(Boolean).join(' ');
      object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << ${resources} >> /Contents ${contentsId} 0 R >>`);
      kids.push(`${pageId} 0 R`);
    }
    object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
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

module.exports = { writePdf, jpegFrame, textWidth };
