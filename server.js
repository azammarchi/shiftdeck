// Minimal local server with no dependencies. It serves the app and runs the
// conversions with the tools in engines/. Files only ever travel between the
// browser and this machine: uploads and results live in a temporary folder
// that is deleted when the server stops.
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { once } = require('events');
const { pipeline } = require('stream/promises');
const { exec } = require('child_process');
const { TOOLS, engines, runTool } = require('./engines');
const { writeZip } = require('./lib/zip');

const PORT = process.env.PORT !== undefined ? Number(process.env.PORT) : 5174;
const ROOT = path.join(__dirname, 'public');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shiftdeck-'));
const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const DOWNLOAD_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
};

// The temporary folder goes away with the server, however it stops.
function cleanUp() {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}
process.on('exit', cleanUp);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0));

// ---------------------------------------------------------------------------
// Auto-stop: every open tab keeps a connection on /events. When the last one
// closes (and doesn't come back within the grace period, which covers page
// reloads) the server stops. Disable with KEEP_RUNNING=1.
// ---------------------------------------------------------------------------
const SHUTDOWN_GRACE_MS = 3000;
const clients = new Set();
let shutdownTimer = null;

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 1000\n\n');
  clients.add(res);
  clearTimeout(shutdownTimer);
  const ping = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
    if (clients.size === 0 && !process.env.KEEP_RUNNING) {
      shutdownTimer = setTimeout(() => {
        console.log('Window closed, stopping Shiftdeck.');
        process.exit(0);
      }, SHUTDOWN_GRACE_MS);
    }
  });
}

// ---------------------------------------------------------------------------
// Files: every upload and every result gets a random id. Only the id ever
// reaches the disk as a name; the original name is kept here for downloads.
// ---------------------------------------------------------------------------
const uploads = new Map(); // id → { path, name, size }
const outputs = new Map(); // id → { path, name, size }
const bundles = new Map(); // id → { name, outputs: [output ids] }
const ID_PATTERN = /^[0-9a-f-]{36}$/;

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: message, code });
}

async function readJson(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Too large'), { status: 413, code: 'tooLarge' });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400, code: 'badRequest' });
  }
}

async function receiveUpload(req, res, url) {
  const name = (url.searchParams.get('name') || '').slice(0, 255);
  if (!name) return sendError(res, 400, 'badRequest', 'Missing file name');
  const declared = Number(req.headers['content-length']);
  if (declared > MAX_UPLOAD_BYTES) return sendError(res, 413, 'tooLarge', 'File too large');
  const id = crypto.randomUUID();
  const dir = path.join(WORK_DIR, 'uploads');
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, id + path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, ''));
  let size = 0;
  try {
    await pipeline(
      req,
      async function* limit(source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File too large'), { status: 413, code: 'tooLarge' });
          yield chunk;
        }
      },
      fs.createWriteStream(file, { mode: 0o600 }),
    );
  } catch (err) {
    await fsp.rm(file, { force: true });
    throw err;
  }
  uploads.set(id, { path: file, name, size });
  sendJson(res, 200, { id, name, size });
}

async function removeUpload(res, id) {
  const upload = uploads.get(id);
  uploads.delete(id);
  if (upload) await fsp.rm(upload.path, { force: true });
  sendJson(res, 200, { removed: !!upload });
}

async function runToolRequest(req, res, toolName) {
  const { files = [], options = {} } = await readJson(req, 64 * 1024);
  if (!Array.isArray(files) || typeof options !== 'object' || options === null) {
    return sendError(res, 400, 'badRequest', 'Expected { files: [ids], options: {} }');
  }
  const inputs = files.map((id) => uploads.get(id));
  if (inputs.some((input) => !input)) return sendError(res, 404, 'missingFile', 'A file is no longer available, add it again');
  const outDir = path.join(WORK_DIR, 'outputs', crypto.randomUUID());
  await fsp.mkdir(outDir, { recursive: true });
  let result;
  try {
    result = await runTool(toolName, inputs, options, outDir);
  } catch (err) {
    await fsp.rm(outDir, { recursive: true, force: true });
    if (!err.code || err.code === 'failed' || err.code === 'writeFailed') console.error(`${toolName}:`, err.message);
    return sendError(res, err.code === 'badTool' ? 404 : 422, err.code || 'failed', err.message);
  }
  const listed = [];
  for (const file of result.outputs) {
    const id = crypto.randomUUID();
    const { size } = await fsp.stat(file);
    const entry = { path: file, name: path.basename(file), size };
    outputs.set(id, entry);
    listed.push({ id, name: entry.name, size });
  }
  // Several results can also be downloaded together, as one ZIP.
  let bundle = null;
  if (listed.length > 1) {
    const first = inputs[0].name;
    const stem = path.basename(first, path.extname(first)).replace(/[^\p{L}\p{N} ._()-]+/gu, '_').trim().slice(0, 80) || 'shiftdeck';
    bundle = { id: crypto.randomUUID(), name: `${stem}-${toolName}.zip` };
    bundles.set(bundle.id, { name: bundle.name, outputs: listed.map((output) => output.id) });
  }
  sendJson(res, 200, { outputs: listed, bundle, warnings: result.warnings });
}

function attachment(name) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sendOutput(res, id) {
  const output = outputs.get(id);
  if (!output) return sendError(res, 404, 'missingFile', 'No such result');
  res.writeHead(200, {
    'Content-Type': DOWNLOAD_TYPES[path.extname(output.name).toLowerCase()] || 'application/octet-stream',
    'Content-Length': output.size,
    'Content-Disposition': attachment(output.name),
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(output.path).pipe(res);
}

// The ZIP is written as it is sent, one file at a time, waiting for the
// connection when it falls behind.
async function sendBundle(res, id) {
  const bundle = bundles.get(id);
  const files = bundle?.outputs.map((outputId) => outputs.get(outputId)).filter(Boolean);
  if (!files?.length) return sendError(res, 404, 'missingFile', 'No such result');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': attachment(bundle.name),
    'Cache-Control': 'no-store',
  });
  await writeZip(files, (buffer) => (res.write(buffer) ? undefined : once(res, 'drain')));
  res.end();
}

// GET    /api/status           → { engines, tools: { name: { accepts, mode, minFiles, needs, ...details } } }
// PUT    /api/uploads?name=…   ← file bytes → { id, name, size }
// DELETE /api/uploads/:id
// POST   /api/tools/:tool      ← { files: [upload ids], options } → { outputs: [{ id, name, size }], bundle: { id, name } | null, warnings }
// GET    /api/outputs/:id      → the result, as a download
// GET    /api/bundles/:id      → all the results of one run, as a ZIP
async function handleApi(req, res, url) {
  const [section, id, extra] = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  if (extra) return sendError(res, 404, 'notFound', 'Not found');

  if (section === 'status' && !id && req.method === 'GET') {
    const tools = {};
    for (const [name, tool] of Object.entries(TOOLS)) {
      tools[name] = { accepts: tool.accepts, mode: tool.mode, minFiles: tool.minFiles || 1, needs: tool.needs(), ...(tool.details ? await tool.details() : {}) };
    }
    return sendJson(res, 200, { engines: engines(), tools });
  }
  if (section === 'uploads' && !id && req.method === 'PUT') return receiveUpload(req, res, url);
  if (section === 'uploads' && ID_PATTERN.test(id || '') && req.method === 'DELETE') return removeUpload(res, id);
  if (section === 'tools' && id && req.method === 'POST') {
    // A JSON content type can't be sent across sites without a CORS preflight,
    // which this server never answers.
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendError(res, 415, 'badRequest', 'Expected JSON');
    return runToolRequest(req, res, id);
  }
  if (section === 'outputs' && ID_PATTERN.test(id || '') && req.method === 'GET') return sendOutput(res, id);
  if (section === 'bundles' && ID_PATTERN.test(id || '') && req.method === 'GET') return sendBundle(res, id);
  sendError(res, 404, 'notFound', 'Not found');
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

// Only requests addressed to this machine by name are answered, which defeats
// DNS rebinding, and requests that a page on another site sent are refused.
function isLocalHost(host) {
  const name = (host || '').replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]';
}

function isLocalOrigin(origin) {
  if (!origin) return true;
  try {
    return isLocalHost(new URL(origin).host);
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  if (!isLocalHost(req.headers.host) || !isLocalOrigin(req.headers.origin)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  let urlPath;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (urlPath === '/events') {
    handleEvents(req, res);
    return;
  }
  if (urlPath.startsWith('/api/')) {
    try {
      await handleApi(req, res, url);
    } catch (err) {
      if (!err.status) console.error(err);
      if (!res.headersSent) sendError(res, err.status || 500, err.code || 'failed', err.status ? err.message : 'Server error');
      else res.destroy();
    }
    return;
  }
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  // Only files inside public/: a plain prefix check would also let through a
  // sibling folder whose name starts the same way (public-something/).
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

// If the port is taken, try the next ones instead of crashing. PORT=0 lets
// the system pick a free one (the tests do this).
function listen(port, attemptsLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} is in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  });
  server.listen(port, '127.0.0.1');
}

server.on('listening', () => {
  // Some tools ask their engine what it can do (ImageMagick's formats, for
  // one), which takes a moment: ask now, so the app's first request finds the
  // answer ready.
  for (const tool of Object.values(TOOLS)) tool.details?.().catch(() => {});
  const url = `http://localhost:${server.address().port}`;
  const found = engines();
  const missing = Object.entries(TOOLS).flatMap(([, tool]) => tool.needs()).filter((v, i, all) => all.indexOf(v) === i);
  console.log(`Shiftdeck is running at ${url}`);
  console.log(`Engines: ${Object.entries(found).map(([name, ok]) => `${name} ${ok ? 'yes' : 'no'}`).join(', ')}`);
  if (missing.length) console.log(`Some tools need ${missing.join(', ')}: run npm run setup to install them.`);
  if (!process.env.NO_OPEN) openBrowser(url);
});

// Opens the URL in the default browser. Disable with NO_OPEN=1.
function openBrowser(url) {
  const command =
    process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) console.log(`Open ${url} in your browser.`);
  });
}

listen(PORT, 10);
