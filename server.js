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
const { pipeline } = require('stream/promises');
const { exec } = require('child_process');
const { TOOLS, engines, runTool } = require('./engines');

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
  sendJson(res, 200, { outputs: listed, warnings: result.warnings });
}

function sendOutput(res, id) {
  const output = outputs.get(id);
  if (!output) return sendError(res, 404, 'missingFile', 'No such result');
  const ascii = output.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  res.writeHead(200, {
    'Content-Type': DOWNLOAD_TYPES[path.extname(output.name).toLowerCase()] || 'application/octet-stream',
    'Content-Length': output.size,
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(output.name)}`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(output.path).pipe(res);
}

// GET    /api/status           → { engines, tools: { name: { accepts, mode, minFiles, needs } } }
// PUT    /api/uploads?name=…   ← file bytes → { id, name, size }
// DELETE /api/uploads/:id
// POST   /api/tools/:tool      ← { files: [upload ids], options } → { outputs: [{ id, name, size }], warnings }
// GET    /api/outputs/:id      → the result, as a download
async function handleApi(req, res, url) {
  const [section, id, extra] = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  if (extra) return sendError(res, 404, 'notFound', 'Not found');

  if (section === 'status' && !id && req.method === 'GET') {
    const tools = Object.fromEntries(Object.entries(TOOLS).map(([name, tool]) => [name, { accepts: tool.accepts, mode: tool.mode, minFiles: tool.minFiles || 1, needs: tool.needs() }]));
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
