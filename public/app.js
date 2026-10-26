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
  loaded: false, // the tools and engines have come from the server
  pages: null, // Organize pages: [{ page, size, rotation, image, turn, deleted }] in the new order
  pagesFor: null, // the key of the file those pages belong to
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
  if (name === 'organize') loadPages();
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
// Organize pages: the first PDF's pages as cards that can be moved, turned
// and removed, with buttons (keyboard) or by dragging (mouse).
// ---------------------------------------------------------------------------
let pagesLoading = null;

async function loadPages() {
  const file = state.files.find(accepts);
  if (!file) {
    state.pages = null;
    state.pagesFor = null;
    renderPages();
    return;
  }
  if (state.pagesFor === file.key && (state.pages || pagesLoading)) {
    renderPages();
    return;
  }
  state.pagesFor = file.key;
  state.pages = null;
  $('pagesStatus').textContent = t('loadingPages');
  $('pageGrid').replaceChildren();
  const loading = (async () => {
    await file.upload;
    if (!file.id) throw Object.assign(new Error(file.error || ''), { code: 'generic' });
    const response = await fetch(`/api/uploads/${file.id}/pages`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body.error || response.statusText), { code: body.code });
    return body.pages;
  })();
  pagesLoading = loading;
  try {
    const pages = await loading;
    if (state.pagesFor !== file.key) return; // another file took its place meanwhile
    state.pages = pages.map((p) => ({ ...p, turn: 0, deleted: false }));
    renderPages();
  } catch (err) {
    if (state.pagesFor === file.key) $('pagesStatus').textContent = errorText(err.code, err.message, { name: file.name });
  } finally {
    if (pagesLoading === loading) pagesLoading = null;
  }
}

function renderPages() {
  const grid = $('pageGrid');
  grid.replaceChildren();
  const pages = state.pages || [];
  $('resetPagesButton').hidden = !pages.length;
  if (!state.pages) {
    if (!pagesLoading) $('pagesStatus').textContent = t('pagesEmpty');
    return;
  }
  $('pagesStatus').textContent = t('pagesSummary', { kept: pages.filter((p) => !p.deleted).length, count: pages.length });
  pages.forEach((page, index) => {
    const card = document.createElement('li');
    card.className = `page-card${page.deleted ? ' deleted' : ''}`;
    card.draggable = true;
    card.dataset.index = index;
    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    const img = document.createElement('img');
    img.src = page.image;
    img.alt = t('pageLabel', { n: page.page });
    img.style.transform = page.turn ? `rotate(${page.turn}deg)` : '';
    thumb.append(img);
    const number = document.createElement('span');
    number.className = 'page-number';
    number.textContent = page.deleted ? t('pageRemoved', { n: page.page }) : t('pageLabel', { n: page.page });
    const actions = document.createElement('div');
    actions.className = 'page-actions';
    const n = page.page;
    actions.append(
      Object.assign(iconButton('earlier', t('pageEarlier', { n }), 'left'), { disabled: index === 0 }),
      Object.assign(iconButton('later', t('pageLater', { n }), 'right'), { disabled: index === pages.length - 1 }),
      iconButton('turnLeft', t('pageTurnLeft', { n }), 'turn-left'),
      iconButton('turnRight', t('pageTurnRight', { n }), 'rotate'),
      page.deleted ? iconButton('restore', t('pageRestore', { n }), 'undo') : iconButton('delete', t('pageDelete', { n }), 'trash'),
    );
    card.append(thumb, number, actions);
    grid.append(card);
  });
}

function movePage(from, to, announce = true) {
  const pages = state.pages;
  if (!pages || to < 0 || to >= pages.length || from === to) return;
  const [page] = pages.splice(from, 1);
  pages.splice(to, 0, page);
  renderPages();
  if (announce) setStatus(t('pageMoved', { n: page.page, position: to + 1 }));
}

function onPageAction(e) {
  const button = e.target.closest('button[data-action]');
  if (!button) return;
  const index = Number(button.closest('li').dataset.index);
  const page = state.pages[index];
  const action = button.dataset.action;
  if (action === 'earlier' || action === 'later') {
    const to = index + (action === 'earlier' ? -1 : 1);
    movePage(index, to);
    // Keep the keyboard on the moved page, on a button that still works.
    const card = $('pageGrid').children[to];
    const wanted = card.querySelector(`[data-action="${action}"]`);
    (wanted.disabled ? card.querySelector(`[data-action="${action === 'earlier' ? 'later' : 'earlier'}"]`) : wanted).focus();
    return;
  }
  if (action === 'turnLeft' || action === 'turnRight') {
    page.turn = (page.turn + (action === 'turnRight' ? 90 : 270)) % 360;
    setStatus(t('pageTurned', { n: page.page, degrees: page.turn }));
  } else if (action === 'delete' || action === 'restore') {
    page.deleted = action === 'delete';
    setStatus(t(page.deleted ? 'pageRemoved' : 'pageRestored', { n: page.page }));
  }
  renderPages();
  // The delete button becomes restore and vice versa: focus the new one.
  const swapped = { delete: 'restore', restore: 'delete' }[action] || action;
  $('pageGrid').children[index].querySelector(`[data-action="${swapped}"]`).focus();
}

function setUpPageDragging() {
  const grid = $('pageGrid');
  let from = null;
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.page-card');
    if (!card) return;
    from = Number(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(from));
  });
  grid.addEventListener('dragover', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    for (const card of grid.querySelectorAll('.drop-target')) card.classList.remove('drop-target');
    e.target.closest('.page-card')?.classList.add('drop-target');
  });
  grid.addEventListener('drop', (e) => {
    if (from === null) return;
    e.preventDefault();
    e.stopPropagation();
    const card = e.target.closest('.page-card');
    if (card) movePage(from, Number(card.dataset.index));
    from = null;
  });
  grid.addEventListener('dragend', () => {
    from = null;
    for (const card of grid.querySelectorAll('.dragging, .drop-target')) card.classList.remove('dragging', 'drop-target');
  });
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
  if (state.tool === 'organize') loadPages();
}

function updateRunButton() {
  const run = $('runButton');
  run.disabled = state.busy || !state.loaded || (currentTool().needs || []).length > 0;
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
  if (state.tool === 'organize' && state.pages) {
    options.pages = state.pages.filter((p) => !p.deleted).map(({ page, turn }) => ({ page, turn }));
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
  if (tool.maxFiles && usable.length > tool.maxFiles) {
    setStatus(t('err_tooManyFiles'), 'error');
    return;
  }
  if (state.tool === 'organize' && state.pages && !state.pages.some((p) => !p.deleted)) {
    setStatus(t('err_noPages'), 'error');
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
    state.loaded = true;
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
  $('pageGrid').addEventListener('click', onPageAction);
  $('resetPagesButton').addEventListener('click', () => {
    state.pages.sort((a, b) => a.page - b.page);
    for (const page of state.pages) Object.assign(page, { turn: 0, deleted: false });
    renderPages();
    setStatus(t('pagesReset'));
  });
  setUpPageDragging();
  $('showPassword').addEventListener('change', (e) => {
    $('passwordInput').type = e.target.checked ? 'text' : 'password';
  });
  $('optionsForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.busy) runTool();
  });

  // The page shows the chosen tool right away; Convert waits until the server
  // has said which tools and formats this computer has.
  selectTool(document.querySelector('input[name="tool"]:checked').value);
  await loadStatus();
  selectTool(state.tool);

  // Keeps the local server running while this tab is open (see server.js).
  new EventSource('/events');
}

init();
