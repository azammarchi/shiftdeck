'use strict';

// ---------------------------------------------------------------------------
// State. Files are uploaded to the local server as soon as they're added, so
// a conversion only has to send their ids. Results are downloads served by it.
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const state = {
  tool: 'merge',
  tools: {}, // from /api/status: name → { accepts, mode, minFiles }
  engines: {},
  files: [], // { key, name, size, ext, id, upload: Promise, error }
  busy: false,
};
let nextKey = 1;

const extension = (name) => (/\.[^.]+$/.exec(name)?.[0] || '').toLowerCase();

function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(currentLanguage, { maximumFractionDigits: unit ? 1 : 0 }).format(value)} ${units[unit]}`;
}

function errorText(code, message, vars = {}) {
  const key = `err_${code}`;
  return LANGUAGES.en.strings[key] ? t(key, { error: message, ...vars }) : t('err_generic', { error: message });
}

function setStatus(text, kind = '') {
  const status = $('status');
  status.textContent = text;
  status.className = `status ${kind}`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
function currentTool() {
  return state.tools[state.tool] || { accepts: ['.pdf'], mode: 'each', minFiles: 1 };
}

function accepts(file) {
  return currentTool().accepts.includes(file.ext);
}

function selectTool(name) {
  state.tool = name;
  $('toolTitle').textContent = t(`tool_${name}`);
  $('toolHint').textContent = t(`tool_${name}_hint`);
  const tool = currentTool();
  $('fileInput').accept = tool.accepts.join(',');
  $('acceptsHint').textContent = t(tool.accepts.includes('.pdf') ? 'acceptsPdf' : 'acceptsImages');
  let visibleFields = 0;
  for (const el of $('optionsForm').querySelectorAll('[data-for]')) {
    const show = el.dataset.for.split(' ').includes(name);
    el.hidden = !show;
    if (show && el.classList.contains('field')) visibleFields++;
  }
  const missing = tool.needs || [];
  $('missingNotice').textContent = t('missingEngines', { engines: new Intl.ListFormat(currentLanguage).format(missing) });
  $('missingNotice').hidden = missing.length === 0;
  // Only PDFKit, on macOS, can protect a PDF without qpdf, and only weakly.
  $('weakNotice').hidden = name !== 'protect' || state.engines.qpdf !== false || !state.engines.pdfkit;
  $('strongNotice').hidden = name !== 'protect' || !state.engines.qpdf;
  $('optionsHeading').hidden = visibleFields === 0;
  if (name === 'convert-images') updateImageOptions();
  $('results').hidden = true;
  setStatus('');
  renderFiles();
}

// Convert images: only the formats this computer can write are offered, and
// quality only matters for the lossy ones.
const LOSSY_FORMATS = ['jpeg', 'webp', 'heic'];

function updateImageOptions() {
  const writable = state.tools['convert-images']?.formats || [];
  const select = $('imageFormatSelect');
  const unavailable = [];
  for (const option of select.options) {
    option.disabled = !writable.includes(option.value);
    if (option.disabled) unavailable.push(option.textContent);
  }
  if (select.selectedOptions[0]?.disabled) {
    const first = [...select.options].find((option) => !option.disabled);
    if (first) select.value = first.value;
  }
  $('formatsHint').textContent = t('formatsUnavailable', { formats: new Intl.ListFormat(currentLanguage).format(unavailable) });
  $('formatsHint').hidden = unavailable.length === 0 || writable.length === 0;
  $('qualityField').hidden = !LOSSY_FORMATS.includes(select.value);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
async function upload(file) {
  const response = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || response.statusText), { code: body.code });
  return body.id;
}

function addFiles(list) {
  for (const file of list) {
    const entry = { key: nextKey++, name: file.name, size: file.size, ext: extension(file.name), id: null, error: null };
    entry.upload = upload(file).then(
      (id) => { entry.id = id; },
      (err) => { entry.error = err.message; },
    ).finally(renderFiles);
    state.files.push(entry);
  }
  renderFiles();
}

function removeFile(key) {
  const entry = state.files.find((f) => f.key === key);
  state.files = state.files.filter((f) => f.key !== key);
  // Also frees uploads still in progress, once they finish.
  entry?.upload.then(() => entry.id && fetch(`/api/uploads/${entry.id}`, { method: 'DELETE' })).catch(() => {});
  renderFiles();
}

function moveFile(key, delta) {
  const index = state.files.findIndex((f) => f.key === key);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= state.files.length) return;
  [state.files[index], state.files[target]] = [state.files[target], state.files[index]];
  renderFiles();
  // Keep the keyboard on the same button of the moved file, or on its other
  // arrow when this one just became disabled at the end of the list.
  const row = $('fileList').querySelector(`[data-key="${key}"]`);
  const wanted = row.querySelector(`[data-action="${delta < 0 ? 'up' : 'down'}"]`);
  (wanted.disabled ? row.querySelector(`[data-action="${delta < 0 ? 'down' : 'up'}"]`) : wanted).focus();
}

function iconButton(action, label, icon, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-button';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = disabled;
  button.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${icon}"/></svg>`;
  return button;
}

function renderFiles() {
  const list = $('fileList');
  list.replaceChildren();
  const ordered = currentTool().mode === 'combine';
  state.files.forEach((file, i) => {
    const row = document.createElement('li');
    row.dataset.key = file.key;
    const usable = accepts(file);
    if (!usable || file.error) row.classList.add('invalid');

    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = file.error ? t('uploadFailed', { error: file.error })
      : !usable ? t('wrongTypeForTool')
      : file.id ? formatSize(file.size)
      : t('uploading');
    info.append(name, meta);
    row.append(info);

    const actions = document.createElement('div');
    actions.className = 'file-actions';
    if (ordered) {
      actions.append(
        iconButton('up', t('moveUp', { name: file.name }), 'up', i === 0),
        iconButton('down', t('moveDown', { name: file.name }), 'down', i === state.files.length - 1),
      );
    }
    actions.append(iconButton('remove', t('remove', { name: file.name }), 'x'));
    row.append(actions);
    list.append(row);
  });
  $('noFiles').hidden = state.files.length > 0;
  $('clearButton').hidden = state.files.length === 0;
  updateRunButton();
}

function updateRunButton() {
  const run = $('runButton');
  run.disabled = state.busy || (currentTool().needs || []).length > 0;
  run.setAttribute('aria-busy', String(state.busy));
  $('runLabel').textContent = t(state.busy ? 'running' : 'run');
}

// ---------------------------------------------------------------------------
// Running a tool
// ---------------------------------------------------------------------------
function readOptions() {
  const form = $('optionsForm');
  const options = {};
  for (const el of form.querySelectorAll('[data-for] [name]')) {
    if (el.closest('[data-for]').hidden) continue;
    if (el.type === 'checkbox') options[el.name] = el.checked;
    else if (el.type === 'number') {
      // An empty number field means "not set" (for example, keep the size).
      if (el.value !== '') options[el.name] = Number(el.value);
    } else options[el.name] = el.value;
  }
  return options;
}

async function runTool() {
  const tool = currentTool();
  const usable = state.files.filter(accepts);
  // A file that doesn't fit is the thing to fix first, whatever else is wrong.
  if (usable.length < state.files.length) {
    setStatus(t('err_wrongType'), 'error');
    return;
  }
  if (usable.length < tool.minFiles) {
    setStatus(t('needFiles', { count: tool.minFiles }), 'error');
    return;
  }
  state.busy = true;
  updateRunButton();
  setStatus(t('running'));
  $('results').hidden = true;
  try {
    await Promise.all(usable.map((f) => f.upload));
    const failed = usable.find((f) => f.error);
    if (failed) throw Object.assign(new Error(failed.error), { code: 'generic' });
    const response = await fetch(`/api/tools/${state.tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: usable.map((f) => f.id), options: readOptions() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || response.statusText), { code: body.code });
    showResults(body.outputs, body.bundle, body.warnings || []);
  } catch (err) {
    const message = err instanceof TypeError ? t('serverDown') : errorText(err.code, err.message, { name: usable[0]?.name });
    setStatus(message, 'error');
  } finally {
    state.busy = false;
    updateRunButton();
  }
}

function showResults(outputs, bundle, warnings) {
  const list = $('resultList');
  list.replaceChildren();
  for (const output of outputs) {
    const row = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'file-info';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = output.name;
    const meta = document.createElement('span');
    meta.className = 'muted small';
    meta.textContent = formatSize(output.size);
    info.append(name, meta);
    const link = document.createElement('a');
    link.className = 'button';
    link.href = `/api/outputs/${output.id}`;
    link.download = output.name;
    link.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-download"/></svg>';
    const label = document.createElement('span');
    label.textContent = t('download');
    link.append(label);
    link.setAttribute('aria-label', `${t('download')} ${output.name}`);
    row.append(info, link);
    list.append(row);
  }
  // Several results come together as one ZIP, made by the server.
  const all = $('downloadAllLink');
  all.hidden = !bundle;
  if (bundle) {
    all.href = `/api/bundles/${bundle.id}`;
    all.download = bundle.name;
  }
  $('results').hidden = false;
  const text = [t('done', { count: outputs.length })];
  if (warnings.includes('weakEncryption')) text.push(t('weakEncryptionNotice'));
  setStatus(text.join(' '), warnings.length ? 'warning' : 'success');
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function setUpLanguages() {
  const select = $('languageSelect');
  for (const [code, language] of Object.entries(LANGUAGES)) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = language.name;
    option.lang = code;
    select.append(option);
  }
  select.value = currentLanguage;
  select.addEventListener('change', () => {
    setLanguage(select.value);
    selectTool(state.tool);
  });
}

function setUpDragAndDrop() {
  const zone = $('dropZone');
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    zone.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('dragging');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('dragging');
    if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files);
  });
}

async function loadStatus() {
  try {
    const response = await fetch('/api/status');
    const body = await response.json();
    state.tools = body.tools;
    state.engines = body.engines;
  } catch {
    $('engineNotice').textContent = t('serverDown');
    $('engineNotice').hidden = false;
    return;
  }
}

async function init() {
  applyTranslations();
  setUpLanguages();
  setUpDragAndDrop();

  for (const radio of document.querySelectorAll('input[name="tool"]')) {
    radio.addEventListener('change', () => selectTool(radio.value));
  }
  $('chooseButton').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  });
  $('fileList').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const key = Number(button.closest('li').dataset.key);
    if (button.dataset.action === 'remove') removeFile(key);
    else moveFile(key, button.dataset.action === 'up' ? -1 : 1);
  });
  $('clearButton').addEventListener('click', () => {
    for (const file of [...state.files]) removeFile(file.key);
    $('chooseButton').focus();
  });
  $('imageFormatSelect').addEventListener('change', updateImageOptions);
  $('showPassword').addEventListener('change', (e) => {
    $('passwordInput').type = e.target.checked ? 'text' : 'password';
  });
  $('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.busy) runTool();
  });

  await loadStatus();
  selectTool(document.querySelector('input[name="tool"]:checked').value);

  // Keeps the local server running while this tab is open (see server.js).
  new EventSource('/events');
}

init();
