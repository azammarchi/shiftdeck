'use strict';

// ---------------------------------------------------------------------------
// Translations. Every UI string lives in public/locales/<code>.js, keyed by
// an id; each file calls registerStrings(code, { ... }). Elements in the HTML
// point to a key with data-i18n (text) or data-i18n-label (aria-label); code
// uses t('key', { vars }), and t('key', { count }) picks key_one / key_other
// by the language's plural rules. Missing keys fall back to English.
//
// Only English (the fallback) and the chosen language are loaded. To add a
// language, add it below with its name and a small SVG flag, copy
// locales/en.js to locales/<code>.js and translate it; add dir: 'rtl' for
// right-to-left languages.
// ---------------------------------------------------------------------------
const DEFAULT_LANGUAGE = 'en';

const LANGUAGES = {
  en: {
    name: "English",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40"><defs><clipPath id="t"><path d="M30 20h30v20zv20H0zH0V0zV0h30z"/></clipPath></defs><rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0 0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0 0 40" clip-path="url(#t)" stroke="#c8102e" stroke-width="5"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="12"/><path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7"/></svg>',
  },
  it: {
    name: "Italiano",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><rect width="10" height="20" fill="#009246"/><rect x="20" width="10" height="20" fill="#ce2b37"/></svg>',
  },
  es: {
    name: "Español",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/></svg>',
  },
  fr: {
    name: "Français",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><rect width="10" height="20" fill="#002654"/><rect x="20" width="10" height="20" fill="#ce1126"/></svg>',
  },
  de: {
    name: "Deutsch",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#000"/><rect y="6.67" width="30" height="6.67" fill="#dd0000"/><rect y="13.33" width="30" height="6.67" fill="#ffce00"/></svg>',
  },
  pt: {
    name: "Português",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#ff0000"/><rect width="12" height="20" fill="#006600"/><circle cx="12" cy="10" r="4.2" fill="#ffcc00"/><path d="M10 8h4v3a2 2 0 0 1-4 0z" fill="#fff" stroke="#ff0000" stroke-width=".8"/></svg>',
  },
  ru: {
    name: "Русский",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><rect y="6.67" width="30" height="6.67" fill="#0039a6"/><rect y="13.33" width="30" height="6.67" fill="#d52b1e"/></svg>',
  },
  zh: {
    name: "中文",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#de2910"/><polygon points="5.00,2.00 5.67,4.07 7.85,4.07 6.09,5.35 6.76,7.43 5.00,6.15 3.24,7.43 3.91,5.35 2.15,4.07 4.33,4.07" fill="#ffde00"/><polygon points="9.06,2.57 9.58,1.96 9.17,1.28 9.91,1.59 10.43,0.99 10.36,1.78 11.10,2.10 10.32,2.28 10.25,3.07 9.84,2.39" fill="#ffde00"/><polygon points="10.91,4.16 11.63,3.80 11.52,3.01 12.07,3.59 12.79,3.23 12.42,3.94 12.97,4.51 12.19,4.38 11.81,5.08 11.70,4.29" fill="#ffde00"/><polygon points="10.94,6.70 11.74,6.67 11.96,5.90 12.23,6.65 13.03,6.62 12.40,7.12 12.68,7.87 12.02,7.42 11.39,7.91 11.61,7.14" fill="#ffde00"/><polygon points="9.14,8.31 9.89,8.59 10.39,7.97 10.35,8.77 11.10,9.05 10.33,9.26 10.29,10.06 9.85,9.39 9.08,9.60 9.58,8.98" fill="#ffde00"/></svg>',
  },
  ja: {
    name: "日本語",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><circle cx="15" cy="10" r="6" fill="#bc002d"/></svg>',
  },
  ko: {
    name: "한국어",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><g transform="translate(15 10) rotate(33.7)"><circle r="5" fill="#0047a0"/><path d="M-5 0a5 5 0 0 1 10 0z" fill="#cd2e3a"/><circle cx="-2.5" r="2.5" fill="#cd2e3a"/><circle cx="2.5" r="2.5" fill="#0047a0"/></g><g transform="translate(6 4.5) rotate(-56.3)" fill="#000"><rect x="-2.5" y="-2" width="5" height=".8"/><rect x="-2.5" y="-.4" width="5" height=".8"/><rect x="-2.5" y="1.2" width="5" height=".8"/></g><g transform="translate(24 15.5) rotate(-56.3)" fill="#000"><rect x="-2.5" y="-2" width="5" height=".8"/><rect x="-2.5" y="-.4" width="5" height=".8"/><rect x="-2.5" y="1.2" width="5" height=".8"/></g><g transform="translate(24 4.5) rotate(56.3)" fill="#000"><rect x="-2.5" y="-2" width="5" height=".8"/><rect x="-2.5" y="-.4" width="5" height=".8"/><rect x="-2.5" y="1.2" width="5" height=".8"/></g><g transform="translate(6 15.5) rotate(56.3)" fill="#000"><rect x="-2.5" y="-2" width="5" height=".8"/><rect x="-2.5" y="-.4" width="5" height=".8"/><rect x="-2.5" y="1.2" width="5" height=".8"/></g></svg>',
  },
  hi: {
    name: "हिन्दी",
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#ff9933"/><rect y="6.67" width="30" height="6.67" fill="#fff"/><rect y="13.33" width="30" height="6.67" fill="#138808"/><circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" stroke-width=".6"/><circle cx="15" cy="10" r=".6" fill="#000080"/></svg>',
  },
  ar: {
    name: "العربية",
    dir: 'rtl',
    flag: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"><rect width="30" height="20" fill="#fff"/><rect width="30" height="6.67" fill="#00732f"/><rect y="13.33" width="30" height="6.67" fill="#000"/><rect width="7.5" height="20" fill="#ff0000"/></svg>',
  },
};

const STRINGS = {}; // code → { key: text }, as the locale files arrive
const loading = {};

function registerStrings(code, strings) {
  STRINGS[code] = strings;
}

// Loads locales/<code>.js once (a script tag, so it also works from GitHub
// Pages and needs no server).
function loadLanguage(code) {
  if (STRINGS[code]) return Promise.resolve();
  loading[code] ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `locales/${code}.js`;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`could not load the ${code} translation`));
    document.head.append(script);
  });
  return loading[code];
}

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

// With a numeric `count`, the key's plural form is used when there is one:
// t('done', { count: 3 }) reads done_other (done_one for 1, in English).
function t(key, vars = {}) {
  const lookup = (k) => STRINGS[currentLanguage]?.[k] ?? STRINGS[DEFAULT_LANGUAGE]?.[k];
  const plural = typeof vars.count === 'number' ? `${key}_${new Intl.PluralRules(currentLanguage).select(vars.count)}` : null;
  const text = (plural && (lookup(plural) ?? lookup(`${key}_other`))) ?? lookup(key) ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
}

function applyTranslations(root = document) {
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = LANGUAGES[currentLanguage].dir || 'ltr';
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}

async function setLanguage(code) {
  if (!LANGUAGES[code]) return;
  await loadLanguage(code);
  currentLanguage = code;
  try {
    localStorage.setItem(LANGUAGE_KEY, code);
  } catch {}
  applyTranslations();
}

const startLanguage = pickLanguage();
