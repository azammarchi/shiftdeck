'use strict';

// ---------------------------------------------------------------------------
// The online demo (GitHub Pages, or any page opened with ?demo). There is no
// server there, so this answers the app's /api/ requests inside the browser,
// for the tools a browser can do by itself: Convert images (PNG, JPEG, WebP)
// and Images to PDF, plus Download all as a ZIP. Files never leave the page.
// The other tools say they run in the app on your computer.
//
// It mirrors what the server does (server.js, engines/index.js): the same
// requests, answers and error codes, so app.js doesn't know the difference,
// except for downloads, which are blob: URLs here.
// ---------------------------------------------------------------------------
const DEMO = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('demo');

if (DEMO) {
  const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.avif'];
  const BROWSER_TOOLS = {
    'convert-images': { accepts: IMAGE_TYPES, mode: 'each', minFiles: 1 },
    'images-to-pdf': { accepts: IMAGE_TYPES, mode: 'combine', minFiles: 1 },
  };
  // Every other tool, as the app lists them, and what it takes.
  const APP_TOOLS = {
    merge: ['.pdf'], split: ['.pdf'], organize: ['.pdf'], 'pdf-to-images': ['.pdf'], 'page-numbers': ['.pdf'], sign: ['.pdf'],
    watermark: ['.pdf'], compress: ['.pdf'], rotate: ['.pdf'], protect: ['.pdf'], unlock: ['.pdf'],
    'convert-audio': ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.mp4', '.mov'], 'convert-video': ['.mp4', '.mov', '.mkv', '.webm'],
  };
  const PAGE_SIZES = { a4: [595, 842], letter: [612, 792] };

  const uploads = new Map(); // id → File
  const outputs = new Map(); // id → { name, size, url }

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fail = (status, code, error) => json(status, { code, error });
  class ToolError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} ._()-]+/gu, '_').trim().slice(0, 80) || 'file';
  const extension = (name) => (/\.[^.]+$/.exec(name)?.[0] || '').toLowerCase();

  // What this browser's canvas can write.
  function writableFormats() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    return ['jpeg', 'png', 'webp'].filter((format) => canvas.toDataURL(`image/${format}`).startsWith(`data:image/${format}`));
  }

  // Decodes an image upright (browsers apply the EXIF orientation) into a
  // canvas, white behind any transparency when `flatten`.
  async function decode(file, { maxSize, flatten } = {}) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      throw new ToolError('notImage', `this browser can't read ${file.name}`);
    }
    const scale = maxSize ? Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height)) : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (flatten) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  }

  const toBlob = (canvas, type, quality) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ToolError('failed', 'the browser could not write the image'))), type, quality);
  });

  async function compress(bytes, format) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function integer(options, key, min, max, fallback) {
    const raw = options[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) throw new ToolError('badOption', `${key} must be a whole number from ${min} to ${max}`);
    return value;
  }

  // Convert images: the canvas re-encodes the picture, which leaves out its
  // metadata (location, camera, date) whatever the option says.
  async function convertImage(file, options) {
    const format = options.format || 'jpeg';
    if (!writableFormats().includes(format)) throw new ToolError('formatUnavailable', `this browser can't write ${format}`);
    const quality = ['jpeg', 'webp'].includes(format) ? integer(options, 'quality', 1, 100, 85) / 100 : undefined;
    const maxSize = integer(options, 'maxSize', 16, 30000, null);
    const canvas = await decode(file, { maxSize, flatten: format === 'jpeg' });
    const blob = await toBlob(canvas, `image/${format}`, quality);
    return { name: `${stem(file.name)}.${format === 'jpeg' ? 'jpg' : format}`, blob };
  }

  // Images to PDF: the same pages as the app (engines/index.js placeImage):
  // A4 or Letter turned to match each image, which is centered and shrunk to
  // fit but never enlarged; photos go in as JPEG, other images losslessly.
  function placeImage(width, height, pageSize) {
    if (pageSize === 'original') return { width, height, box: [0, 0, width, height] };
    const [short, long] = PAGE_SIZES[pageSize];
    const [pageW, pageH] = width > height ? [long, short] : [short, long];
    const fit = Math.min(1, pageW / width, pageH / height);
    const [w, h] = [width * fit, height * fit];
    return { width: pageW, height: pageH, box: [(pageW - w) / 2, (pageH - h) / 2, w, h] };
  }

  async function imagesToPdf(files, options) {
    const pageSize = options.pageSize || 'a4';
    if (!['a4', 'letter', 'original'].includes(pageSize)) throw new ToolError('badOption', 'unknown page size');
    const encoder = new TextEncoder();
    const parts = [];
    let offset = 0;
    const offsets = [];
    const add = (data) => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      parts.push(bytes);
      offset += bytes.length;
    };
    const object = (id, body, stream) => {
      offsets[id] = offset;
      add(`${id} 0 obj\n${body}\n`);
      if (stream) {
        add('stream\n');
        add(stream);
        add('\nendstream\n');
      }
      add('endobj\n');
    };
    const num = (n) => String(Math.round(n * 100) / 100);
    add('%PDF-1.4\n');
    const kids = [];
    let next = 3;
    for (const file of files) {
      const photo = ['.jpg', '.jpeg', '.heic', '.heif', '.webp', '.avif'].includes(extension(file.name));
      const canvas = await decode(file, { flatten: true });
      let data;
      let filter;
      if (photo) {
        data = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.92)).arrayBuffer());
        filter = '/DCTDecode';
      } else {
        const { data: rgba } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const rgb = new Uint8Array(canvas.width * canvas.height * 3);
        for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) rgb.set(rgba.subarray(i, i + 3), j);
        data = await compress(rgb, 'deflate');
        filter = '/FlateDecode';
      }
      const page = placeImage(canvas.width, canvas.height, pageSize);
      const [imageId, contentsId, pageId] = [next++, next++, next++];
      object(imageId, `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter} /Length ${data.length} >>`, data);
      const [x, y, w, h] = page.box;
      const contents = `q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /Im0 Do Q`;
      object(contentsId, `<< /Length ${contents.length} >>`, encoder.encode(contents));
      object(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentsId} 0 R >>`);
      kids.push(`${pageId} 0 R`);
    }
    object(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');
    const xref = offset;
    add(`xref\n0 ${next}\n0000000000 65535 f \n`);
    for (let id = 1; id < next; id++) add(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    add(`trailer\n<< /Size ${next} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return { name: `${stem(files[0].name)}.pdf`, blob: new Blob(parts, { type: 'application/pdf' }) };
  }

  // Download all: the same ZIP as the app (lib/zip.js), deflated where it helps.
  const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function zip(files) {
    const parts = [];
    const central = [];
    let offset = 0;
    const encoder = new TextEncoder();
    const seen = new Set();
    for (const file of files) {
      let name = file.name;
      for (let n = 2; seen.has(name.toLowerCase()); n++) name = file.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      seen.add(name.toLowerCase());
      const data = new Uint8Array(await file.blob.arrayBuffer());
      const deflated = await compress(data, 'deflate-raw');
      const stored = deflated.length >= data.length;
      const body = stored ? data : deflated;
      const nameBytes = encoder.encode(name);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(8, stored ? 0 : 8, true);
      local.setUint32(14, crc32(data), true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      const entry = new DataView(new ArrayBuffer(46));
      entry.setUint32(0, 0x02014b50, true);
      entry.setUint16(4, 20, true);
      entry.setUint16(6, 20, true);
      entry.setUint16(8, 0x0800, true);
      entry.setUint16(10, stored ? 0 : 8, true);
      entry.setUint32(16, crc32(data), true);
      entry.setUint32(20, body.length, true);
      entry.setUint32(24, data.length, true);
      entry.setUint16(28, nameBytes.length, true);
      entry.setUint32(42, offset, true);
      parts.push(new Uint8Array(local.buffer), nameBytes, body);
      offset += 30 + nameBytes.length + body.length;
      central.push(new Uint8Array(entry.buffer), nameBytes);
    }
    const directorySize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  }

  function keep(result) {
    const id = crypto.randomUUID();
    const output = { id, name: result.name, size: result.blob.size, url: URL.createObjectURL(result.blob), blob: result.blob };
    outputs.set(id, output);
    return output;
  }

  async function runTool(name, ids, options) {
    const tool = BROWSER_TOOLS[name];
    if (!tool) {
      if (APP_TOOLS[name]) throw new ToolError('demoOnly', 'this tool runs in the app on your computer');
      throw new ToolError('badTool', `unknown tool ${name}`);
    }
    const files = ids.map((id) => uploads.get(id));
    if (files.some((file) => !file)) throw new ToolError('missingFile', 'A file is no longer available, add it again');
    for (const file of files) {
      if (!tool.accepts.includes(extension(file.name))) throw new ToolError('wrongType', `${file.name} can't be used with ${name}`);
    }
    const results = name === 'images-to-pdf' ? [await imagesToPdf(files, options)] : await Promise.all(files.map((file) => convertImage(file, options)));
    const listed = results.map(keep);
    let bundle = null;
    if (listed.length > 1) {
      const zipName = `${stem(files[0].name)}-${name}.zip`;
      bundle = { name: zipName, url: URL.createObjectURL(await zip(listed)) };
    }
    return { outputs: listed.map(({ id, name: outputName, size, url }) => ({ id, name: outputName, size, url })), bundle, warnings: [] };
  }

  async function answer(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const [section, id] = url.pathname.split('/').filter(Boolean).slice(1);
    if (section === 'status') {
      const tools = {};
      for (const [name, tool] of Object.entries(BROWSER_TOOLS)) tools[name] = { ...tool, needs: [], maxFiles: null, ...(name === 'convert-images' ? { formats: writableFormats() } : {}) };
      for (const [name, accepts] of Object.entries(APP_TOOLS)) tools[name] = { accepts, mode: 'each', minFiles: 1, maxFiles: null, needs: [], demoOnly: true, formats: [] };
      return json(200, { demo: true, engines: {}, tools });
    }
    if (section === 'uploads' && method === 'PUT') {
      const name = url.searchParams.get('name') || 'file';
      const uploadId = crypto.randomUUID();
      uploads.set(uploadId, new File([init.body], name, { type: init.body?.type || '' }));
      return json(200, { id: uploadId, name, size: init.body?.size || 0 });
    }
    if (section === 'uploads' && method === 'DELETE') {
      uploads.delete(id);
      return json(200, { removed: true });
    }
    if (section === 'tools' && method === 'POST') {
      const { files = [], options = {} } = JSON.parse(init.body || '{}');
      try {
        return json(200, await runTool(id, files, options));
      } catch (err) {
        return fail(err.code === 'badTool' ? 404 : 422, err.code || 'failed', err.message);
      }
    }
    return fail(404, 'notFound', 'Not found');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) return answer(url, init);
    return realFetch(input, init);
  };
  window.SHIFTDECK_DEMO = true;
}
