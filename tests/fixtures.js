// Every test gets its own server.js on a free port, so tests never see each
// other's files. A test can hide engines with
// test.use({ serverEnv: { SHIFTDECK_DISABLE_ENGINES: 'qpdf' } }).
const { spawn } = require('child_process');
const path = require('path');
const base = require('@playwright/test');

async function startServer(env = {}) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', NO_OPEN: '1', KEEP_RUNNING: '1', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/localhost:(\d+)/.exec(output);
      if (match) resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.on('exit', (code) => reject(new Error(`server.js exited with code ${code}`)));
  });
  return { url, stop: () => child.kill() };
}

const test = base.test.extend({
  serverEnv: [{}, { option: true }],
  appServer: async ({ serverEnv }, use) => {
    const server = await startServer(serverEnv);
    await use(server);
    server.stop();
  },
  baseURL: async ({ appServer }, use) => use(appServer.url),
});

module.exports = { test, expect: base.expect, startServer };
