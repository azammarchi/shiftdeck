// Engine: FFmpeg (https://ffmpeg.org), on macOS, Linux and Windows. Converts
// audio and video, reporting how far it has got and stopping when asked.
//
// An ffmpeg that is installed but can't start (a library it needs was
// updated or removed, which happens with package managers) counts as
// missing, so the app says to run `npm run setup` instead of failing later.
const { spawn } = require('child_process');
const fsp = require('fs/promises');
const { findProgram, runProgram, stopProgram, ToolError } = require('./run');

const program = () => findProgram('ffmpeg');
const probeProgram = () => findProgram('ffprobe');

// Per ffmpeg program: does it start, and which encoders does it have? The
// question as a promise, and its answer once known.
const checks = new Map();
const outcomes = new Map(); // program → 'works' | 'broken'

function check() {
  const file = program();
  if (!file || !probeProgram()) return Promise.resolve({ works: false, encoders: new Set() });
  if (!checks.has(file)) {
    checks.set(file, runProgram(file, ['-hide_banner', '-encoders']).then(({ code, stdout }) => {
      // Lines look like " A....D libmp3lame  libmp3lame MP3 (MPEG audio layer 3)".
      const encoders = new Set();
      for (const line of stdout.split('\n')) {
        const match = /^\s[AVS][A-Z.]{5}\s+(\S+)/.exec(line);
        if (match) encoders.add(match[1]);
      }
      return { works: code === 0 && encoders.size > 0, encoders };
    }));
  }
  return checks.get(file);
}

// Known once capabilities() has run (the server asks at start); until then
// a found ffmpeg is assumed to work.
function available() {
  const file = program();
  return !!file && !!probeProgram() && outcomes.get(file) !== 'broken';
}

async function capabilities() {
  const file = program();
  const result = await check();
  if (file) outcomes.set(file, result.works ? 'works' : 'broken');
  return result;
}

// Duration in seconds, from ffprobe; null when it can't tell.
async function duration(input) {
  const { code, stdout } = await runProgram(probeProgram(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
  const seconds = Number(stdout.trim());
  return code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Facts about a file's streams, for the tests: { duration, streams: [{ type, codec, width, height }] }.
async function probe(input) {
  const { code, stdout, stderr } = await runProgram(probeProgram(), ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', input]);
  if (code !== 0) throw new ToolError('notMedia', stderr.trim());
  const json = JSON.parse(stdout);
  return {
    duration: Number(json.format?.duration) || null,
    streams: (json.streams || []).map((s) => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height })),
  };
}

// Runs ffmpeg with `args` (input and output included) and reports progress
// as a fraction of `total` seconds. Stops, and removes `output`, when
// `signal` aborts.
async function convert(args, output, { total, onProgress, signal } = {}) {
  const { works } = await capabilities();
  if (!works) throw new ToolError('noEngine', 'ffmpeg is missing or does not start: run npm run setup');
  if (signal?.aborted) throw new ToolError('cancelled', 'cancelled');
  const child = spawn(program(), ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  let pending = '';
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) {
      const match = /^out_time_us=(\d+)/.exec(line);
      if (match && total && onProgress) onProgress(Math.min(1, Number(match[1]) / 1e6 / total));
    }
  });
  const abort = () => stopProgram(child);
  signal?.addEventListener('abort', abort, { once: true });
  const code = await new Promise((resolve) => {
    child.on('error', () => resolve(-1));
    child.on('close', resolve);
  });
  signal?.removeEventListener('abort', abort);
  if (signal?.aborted) {
    await fsp.rm(output, { force: true });
    throw new ToolError('cancelled', 'cancelled');
  }
  if (code !== 0) {
    await fsp.rm(output, { force: true });
    if (/Invalid data found|could not find codec|does not contain any stream|Output file does not contain/i.test(stderr)) {
      throw new ToolError('notMedia', stderr.trim().split('\n').pop());
    }
    throw new ToolError('failed', stderr.trim().split('\n').slice(-3).join(' '));
  }
  onProgress?.(1);
}

// Forgets what was learnt about ffmpeg, after (re)installing it.
function forget() {
  checks.clear();
  outcomes.clear();
}

module.exports = { available, capabilities, forget, duration, probe, convert };
