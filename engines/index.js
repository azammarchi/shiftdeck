// The tools the app offers, and which engine does each one. A tool either
// combines all its files into one result ("combine") or works on each file
// separately ("each").
const fsp = require('fs/promises');
const path = require('path');
const pdfkitEngine = require('./pdfkit');
const qpdfEngine = require('./qpdf');
const { ToolError } = require('./run');

const { pdfkit } = pdfkitEngine;

const PDF_TYPES = ['.pdf'];
const IMAGE_TYPES = ['.png', '.jpg', '.jpeg', '.heic', '.heif', '.tif', '.tiff', '.gif', '.bmp', '.webp', '.jp2'];
const DPI_RANGE = [36, 600];

// Name for the results: the input's name without its extension, made safe.
function stem(name) {
  const base = path.basename(name, path.extname(name)).replace(/[^\p{L}\p{N} ._()-]+/gu, '_').trim();
  return base.slice(0, 80) || 'file';
}

function option(options, key, allowed, fallback) {
  const value = options[key] ?? fallback;
  if (!allowed.includes(value)) throw new ToolError('badOption', `${key} must be one of ${allowed.join(', ')}`);
  return value;
}

function requirePassword(options) {
  const password = typeof options.password === 'string' ? options.password : '';
  if (!password) throw new ToolError('noPassword', 'no password given');
  return password;
}

const TOOLS = {
  merge: {
    accepts: PDF_TYPES,
    mode: 'combine',
    minFiles: 2,
    async run(files, options, outDir) {
      const output = path.join(outDir, `${stem(files[0].name)}-merged.pdf`);
      return pdfkit('merge', [output, ...files.map((f) => f.path)]);
    },
  },

  split: {
    accepts: PDF_TYPES,
    mode: 'each',
    async run(file, options, outDir) {
      const ranges = typeof options.ranges === 'string' ? options.ranges.trim() : '';
      return pdfkit('split', [file.path, outDir, stem(file.name), ...(ranges ? [ranges] : [])]);
    },
  },

  'pdf-to-images': {
    accepts: PDF_TYPES,
    mode: 'each',
    async run(file, options, outDir) {
      const format = option(options, 'format', ['png', 'jpeg'], 'png');
      const dpi = Number(options.dpi ?? 150);
      if (!(dpi >= DPI_RANGE[0] && dpi <= DPI_RANGE[1])) throw new ToolError('badOption', `dpi must be ${DPI_RANGE.join('-')}`);
      return pdfkit('toimages', [file.path, outDir, stem(file.name), format, Math.round(dpi)]);
    },
  },

  'images-to-pdf': {
    accepts: IMAGE_TYPES,
    mode: 'combine',
    async run(files, options, outDir) {
      const pageSize = option(options, 'pageSize', ['a4', 'letter', 'original'], 'a4');
      const output = path.join(outDir, `${stem(files[0].name)}.pdf`);
      return pdfkit('fromimages', [output, pageSize, ...files.map((f) => f.path)]);
    },
  },

  rotate: {
    accepts: PDF_TYPES,
    mode: 'each',
    async run(file, options, outDir) {
      const degrees = option({ degrees: String(options.degrees ?? 90) }, 'degrees', ['90', '180', '270']);
      return pdfkit('rotate', [file.path, path.join(outDir, `${stem(file.name)}-rotated.pdf`), degrees]);
    },
  },

  protect: {
    accepts: PDF_TYPES,
    mode: 'each',
    async run(file, options, outDir) {
      const password = requirePassword(options);
      const info = await pdfkit('info', [file.path]);
      if (info.encrypted) throw new ToolError('alreadyEncrypted', `${file.name} is already password protected`);
      const output = path.join(outDir, `${stem(file.name)}-protected.pdf`);
      if (qpdfEngine.available()) {
        await qpdfEngine.encrypt(file.path, output, password, outDir);
        return { outputs: [output], encryption: 'AES-256' };
      }
      return pdfkit('encrypt', [file.path, output], { password });
    },
  },

  unlock: {
    accepts: PDF_TYPES,
    mode: 'each',
    async run(file, options, outDir) {
      const password = requirePassword(options);
      const info = await pdfkit('info', [file.path]);
      if (!info.encrypted) throw new ToolError('notEncrypted', `${file.name} is not password protected`);
      const output = path.join(outDir, `${stem(file.name)}-unlocked.pdf`);
      if (qpdfEngine.available()) {
        await qpdfEngine.decrypt(file.path, output, password, outDir);
        return { outputs: [output] };
      }
      return pdfkit('decrypt', [file.path, output], { password });
    },
  },
};

function engines() {
  return { pdfkit: pdfkitEngine.available, qpdf: qpdfEngine.available() };
}

// Runs a tool on files ({ path, name }), writing results into outDir.
// Resolves with { outputs: [path], warnings: [code] }. "each" tools give
// every input its own subfolder, so two inputs with the same name can't
// overwrite each other's results.
async function runTool(name, files, options, outDir) {
  const tool = Object.hasOwn(TOOLS, name) ? TOOLS[name] : null;
  if (!tool) throw new ToolError('badTool', `unknown tool ${name}`);
  if (!pdfkitEngine.available) throw new ToolError('noEngine', 'this tool needs macOS');
  if (files.length < (tool.minFiles || 1)) throw new ToolError('tooFewFiles', `${name} needs at least ${tool.minFiles || 1} files`);
  for (const file of files) {
    if (!tool.accepts.includes(path.extname(file.name).toLowerCase())) {
      throw new ToolError('wrongType', `${file.name} can't be used with ${name}`);
    }
  }

  const warnings = new Set();
  const outputs = [];
  const collect = (result) => {
    outputs.push(...result.outputs);
    if (result.encryption === 'RC4-128') warnings.add('weakEncryption');
  };
  if (tool.mode === 'combine') {
    collect(await tool.run(files, options, outDir));
  } else {
    for (const [i, file] of files.entries()) {
      const dir = files.length > 1 ? path.join(outDir, String(i + 1)) : outDir;
      await fsp.mkdir(dir, { recursive: true });
      collect(await tool.run(file, options, dir));
    }
  }
  return { outputs, warnings: [...warnings] };
}

module.exports = { TOOLS, engines, runTool, ToolError, info: (file, password) => pdfkit('info', [file], { password }) };
