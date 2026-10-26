'use strict';

// ---------------------------------------------------------------------------
// Translations. Every UI string lives here, keyed by an id. Elements in the
// HTML point to a key with data-i18n (text) or data-i18n-label (aria-label);
// code uses t('key', { vars }). Missing keys fall back to English. To add a
// language, copy the `en` block and translate it.
// ---------------------------------------------------------------------------
const DEFAULT_LANGUAGE = 'en';

const LANGUAGES = {
  en: {
    name: 'English',
    strings: {
      tagline: 'Convert and edit files on your computer. Nothing is uploaded anywhere.',
      language: 'Language',
      toolsHeading: 'Choose a tool',
      tool_merge: 'Merge PDFs',
      tool_merge_hint: 'Combine several PDFs into one, in the order of the list.',
      tool_split: 'Split PDF',
      tool_split_hint: 'Save every page as its own PDF, or choose page ranges.',
      'tool_pdf-to-images': 'PDF to images',
      'tool_pdf-to-images_hint': 'Turn every page into a PNG or JPEG image.',
      'tool_images-to-pdf': 'Images to PDF',
      'tool_images-to-pdf_hint': 'Make one PDF from photos and images (PNG, JPEG, HEIC…), one per page, in the order of the list.',
      tool_rotate: 'Rotate PDF',
      tool_rotate_hint: 'Turn every page of a PDF.',
      tool_protect: 'Add a password',
      tool_protect_hint: 'Protect a PDF so it only opens with a password.',
      tool_unlock: 'Remove a password',
      tool_unlock_hint: 'Save a copy of a protected PDF that opens without a password. You need to know the password.',
      dropHint: 'Drop files here, or',
      chooseFiles: 'Choose files',
      acceptsPdf: 'PDF files',
      acceptsImages: 'Images: PNG, JPEG, HEIC, TIFF, GIF, BMP, WebP',
      filesHeading: 'Files',
      noFiles: 'No files yet.',
      moveUp: 'Move {name} up',
      moveDown: 'Move {name} down',
      remove: 'Remove {name}',
      uploading: 'Loading…',
      uploadFailed: "Couldn't load: {error}",
      wrongTypeForTool: "Can't be used with this tool",
      clearFiles: 'Remove all',
      optionsHeading: 'Options',
      ranges: 'Pages',
      rangesHint: 'Leave empty for one file per page, or write ranges like 1-3, 4, 5-8.',
      format: 'Image format',
      dpi: 'Resolution (dpi)',
      dpiHint: '72 for screens, 150 for most uses, 300 for printing.',
      pageSize: 'Page size',
      pageA4: 'A4',
      pageLetter: 'US Letter',
      pageOriginal: 'Same as the image',
      degrees: 'Rotation',
      deg90: '90° clockwise',
      deg180: '180°',
      deg270: '90° counterclockwise',
      password: 'Password',
      showPassword: 'Show password',
      weakEncryptionNotice: 'qpdf is not installed, so the password uses RC4 128-bit encryption, which is old and weak. For strong AES-256 encryption, run npm run setup in the Shiftdeck folder (it installs qpdf), then reload this page.',
      strongEncryptionNotice: 'The password uses AES-256 encryption (via qpdf).',
      run: 'Convert',
      running: 'Working…',
      needFiles: 'Add at least {count} file(s) for this tool.',
      done: 'Done: {count} file(s) ready.',
      resultsHeading: 'Results',
      download: 'Download',
      downloadAll: 'Download all',
      missingEngines: 'This tool needs {engines}, which isn\'t installed yet. Run npm run setup in the Shiftdeck folder, then reload this page.',
      serverDown: "Can't reach Shiftdeck. Start it again with npm start.",
      err_locked: '{name} is password protected: remove the password first.',
      err_wrongPassword: 'Wrong password.',
      err_notPdf: "This file isn't a PDF, or it's damaged.",
      err_notImage: "One of the files isn't an image this computer can read.",
      err_badRange: 'Check the pages: {error}',
      err_noPassword: 'Type a password.',
      err_alreadyEncrypted: 'This PDF already has a password.',
      err_notEncrypted: "This PDF doesn't have a password.",
      err_tooFewFiles: 'Add more files for this tool.',
      err_wrongType: 'Some files can\'t be used with this tool.',
      err_missingFile: 'A file is no longer available: add it again.',
      err_tooLarge: 'The file is too large.',
      err_noEngine: 'A program this tool needs is missing: run npm run setup, then reload this page.',
      err_generic: 'Something went wrong: {error}',
      footer: 'Shiftdeck runs on your computer: files stay here, and temporary copies are deleted when you close it.',
    },
  },
  it: {
    name: 'Italiano',
    strings: {
      tagline: 'Converti e modifica file sul tuo computer. Niente viene caricato online.',
      language: 'Lingua',
      toolsHeading: 'Scegli uno strumento',
      tool_merge: 'Unisci PDF',
      tool_merge_hint: "Unisci più PDF in uno solo, nell'ordine della lista.",
      tool_split: 'Dividi PDF',
      tool_split_hint: 'Salva ogni pagina come PDF a sé, oppure scegli degli intervalli di pagine.',
      'tool_pdf-to-images': 'Da PDF a immagini',
      'tool_pdf-to-images_hint': 'Trasforma ogni pagina in un’immagine PNG o JPEG.',
      'tool_images-to-pdf': 'Da immagini a PDF',
      'tool_images-to-pdf_hint': "Crea un PDF da foto e immagini (PNG, JPEG, HEIC…), una per pagina, nell'ordine della lista.",
      tool_rotate: 'Ruota PDF',
      tool_rotate_hint: 'Ruota tutte le pagine di un PDF.',
      tool_protect: 'Aggiungi una password',
      tool_protect_hint: 'Proteggi un PDF in modo che si apra solo con una password.',
      tool_unlock: 'Togli la password',
      tool_unlock_hint: 'Salva una copia di un PDF protetto che si apre senza password. Devi conoscere la password.',
      dropHint: 'Trascina qui i file, oppure',
      chooseFiles: 'Scegli i file',
      acceptsPdf: 'File PDF',
      acceptsImages: 'Immagini: PNG, JPEG, HEIC, TIFF, GIF, BMP, WebP',
      filesHeading: 'File',
      noFiles: 'Ancora nessun file.',
      moveUp: 'Sposta {name} in su',
      moveDown: 'Sposta {name} in giù',
      remove: 'Rimuovi {name}',
      uploading: 'Caricamento…',
      uploadFailed: 'Impossibile caricare: {error}',
      wrongTypeForTool: 'Non si può usare con questo strumento',
      clearFiles: 'Rimuovi tutti',
      optionsHeading: 'Opzioni',
      ranges: 'Pagine',
      rangesHint: 'Lascia vuoto per un file per pagina, oppure scrivi intervalli come 1-3, 4, 5-8.',
      format: 'Formato immagine',
      dpi: 'Risoluzione (dpi)',
      dpiHint: '72 per lo schermo, 150 per la maggior parte degli usi, 300 per la stampa.',
      pageSize: 'Formato pagina',
      pageA4: 'A4',
      pageLetter: 'Lettera USA',
      pageOriginal: "Come l'immagine",
      degrees: 'Rotazione',
      deg90: '90° in senso orario',
      deg180: '180°',
      deg270: '90° in senso antiorario',
      password: 'Password',
      showPassword: 'Mostra la password',
      weakEncryptionNotice: 'qpdf non è installato, quindi la password usa la cifratura RC4 a 128 bit, vecchia e debole. Per una cifratura AES-256 robusta esegui npm run setup nella cartella di Shiftdeck (installa qpdf), poi ricarica questa pagina.',
      strongEncryptionNotice: 'La password usa la cifratura AES-256 (tramite qpdf).',
      run: 'Converti',
      running: 'In corso…',
      needFiles: 'Aggiungi almeno {count} file per questo strumento.',
      done: 'Fatto: {count} file pronti.',
      resultsHeading: 'Risultati',
      download: 'Scarica',
      downloadAll: 'Scarica tutti',
      missingEngines: 'Questo strumento richiede {engines}, che non è ancora installato. Esegui npm run setup nella cartella di Shiftdeck, poi ricarica questa pagina.',
      serverDown: 'Shiftdeck non risponde. Avvialo di nuovo con npm start.',
      err_locked: '{name} è protetto da password: togli prima la password.',
      err_wrongPassword: 'Password sbagliata.',
      err_notPdf: 'Questo file non è un PDF, oppure è danneggiato.',
      err_notImage: "Uno dei file non è un'immagine che questo computer sa leggere.",
      err_badRange: 'Controlla le pagine: {error}',
      err_noPassword: 'Scrivi una password.',
      err_alreadyEncrypted: 'Questo PDF ha già una password.',
      err_notEncrypted: 'Questo PDF non ha una password.',
      err_tooFewFiles: 'Aggiungi altri file per questo strumento.',
      err_wrongType: 'Alcuni file non si possono usare con questo strumento.',
      err_missingFile: 'Un file non è più disponibile: aggiungilo di nuovo.',
      err_tooLarge: 'Il file è troppo grande.',
      err_noEngine: 'Manca un programma che serve a questo strumento: esegui npm run setup, poi ricarica questa pagina.',
      err_generic: 'Qualcosa è andato storto: {error}',
      footer: 'Shiftdeck gira sul tuo computer: i file restano qui e le copie temporanee vengono cancellate quando lo chiudi.',
    },
  },
};

const LANGUAGE_KEY = 'shiftdeck.language';
let currentLanguage = DEFAULT_LANGUAGE;

function pickLanguage() {
  let saved = null;
  try {
    saved = localStorage.getItem(LANGUAGE_KEY);
  } catch {}
  if (saved && LANGUAGES[saved]) return saved;
  for (const wanted of navigator.languages || [navigator.language]) {
    const code = String(wanted).slice(0, 2).toLowerCase();
    if (LANGUAGES[code]) return code;
  }
  return DEFAULT_LANGUAGE;
}

function t(key, vars = {}) {
  const text = LANGUAGES[currentLanguage].strings[key] ?? LANGUAGES[DEFAULT_LANGUAGE].strings[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
}

function applyTranslations(root = document) {
  document.documentElement.lang = currentLanguage;
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

function setLanguage(code) {
  if (!LANGUAGES[code]) return;
  currentLanguage = code;
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {}
  applyTranslations();
}

currentLanguage = pickLanguage();
