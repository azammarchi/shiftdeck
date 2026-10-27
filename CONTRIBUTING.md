# Contributing to Shiftdeck

Thanks for taking the time to help! Bug reports, ideas, translations, new engines and code are all welcome.

## Reporting a bug or suggesting an idea

Open an [issue](https://github.com/azammarchi/shiftdeck/issues/new/choose) and pick a template. For bugs, the most useful things to include are your operating system, your browser, the engines line `npm start` printed, the tool and options you used, and, if you can share it, a file that shows the problem.

Security problems are the exception: please report them privately, as described in [SECURITY.md](SECURITY.md).

## Working on the code

Shiftdeck is plain HTML, CSS and JavaScript with no build step and no npm dependencies at runtime. It runs on macOS, Linux and Windows; you need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm run setup         # installs the engines (qpdf, mutool, ImageMagick) this system needs
npm start             # runs the app at http://localhost:5174
npm install           # test tools only (Playwright, axe-core)
npm run test:install  # the browsers the tests drive
npm test              # engine tests, then end-to-end tests in WebKit, Firefox and Chromium
```

Where things live:

| Path | What |
| --- | --- |
| `public/index.html` | Page structure, icons, tool options |
| `public/app.js` | The interface: tools, files, running a tool, results |
| `public/i18n.js` | All interface text, in every language |
| `public/demo.js` | The online demo: answers the app's requests inside the browser, for the tools a browser can do alone |
| `public/style.css` | Styles |
| `bin/shiftdeck.js` | The `shiftdeck` command: tools from a terminal, and the watched folder |
| `server.js` | Tiny local server (no dependencies): uploads, running tools, downloads |
| `engines/index.js` | The tools: which files they take, their options, which engine runs each one |
| `engines/pdfkit.js`, `pdfkit.jxa.js` | macOS: PDF commands on Apple's PDFKit, run with `osascript -l JavaScript` |
| `engines/qpdf.js`, `mutool.js`, `imagemagick.js`, `ffmpeg.js`, `libreoffice.js`, `tesseract.js` | The cross-platform engines |
| `engines/pdfwrite.js` | A tiny PDF writer (one image per page), so images to PDF needs no PDF engine |
| `engines/run.js` | Finding programs on every system and running them safely |
| `lib/zip.js` | A tiny ZIP writer, for **Download all** |
| `scripts/setup.js` | `npm run setup`: installs the engines with the system's package manager |
| `tests/` | Engine tests (`*.test.js`) and Playwright end-to-end tests (`*.spec.js`) |

### Adding a tool or an engine

1. Add the tool to `TOOLS` in `engines/index.js`: the extensions it accepts, whether it combines files or works on each one, and a `run` function that writes into the folder it gets.
2. If it needs a program, add an engine module that finds it with `findProgram()` and runs it with `runProgram()` from `engines/run.js`, and add its packages to `scripts/setup.js` for every package manager there. **Never** run anything through a shell: file names are data a user chose, and an argument array keeps them that way. Secrets (passwords) never go on the command line, where `ps` shows them: use an environment variable or a file only the user can read, as the existing engines do.
3. **It must work on macOS, Linux and Windows.** Pick programs that exist on all three (and are in their package managers); on macOS, what ships with the system can be used first, as PDFKit is. A tool's `needs()` lists missing engines, so the app can tell the user to run `npm run setup`.
4. Add the tool's name, hint and options to `public/index.html` and `public/i18n.js`, then tests in both layers.

### JavaScript for Automation gotchas

`engines/pdfkit.jxa.js` talks to Apple's frameworks through JXA, which has a few traps: numbers such as `pageCount` come back as strings, and framework constants (`PDFDocumentUserPasswordOption`, `NSFontAttributeName`…) are mostly not bridged, so their values are written out. When in doubt, try a command by hand: `osascript -l JavaScript engines/pdfkit.jxa.js info some.pdf`.

## Guidelines

- **English only** for code, comments, docs and commit messages. Interface text goes in `public/i18n.js`, never directly in HTML or JavaScript.
- **Keep it dependency-free.** No npm packages at runtime; outside programs only as engines that `npm run setup` installs.
- **Add or update tests** for what you change. End-to-end tests use real mouse and keyboard input (`page.mouse`, `page.keyboard`, clicks) rather than synthetic events.
- **Check every browser.** `npm test` runs WebKit (Safari's engine), Firefox and Chromium; CI runs the same on macOS, Linux and Windows for every pull request.
- **Keep it accessible.** New controls need a name and a keyboard path; `tests/a11y.spec.js` runs axe-core on every tool. See [ACCESSIBILITY.md](ACCESSIBILITY.md).

### Translations

To change interface text, update the key in **every** language in `public/i18n.js` (a test fails if any language is missing a key). To add a language, copy the `en` block, set a new code and a `name`, and translate the strings.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`.

- **type**: `feat`, `fix`, `docs`, `test`, `ci`, `chore`, `refactor`, `style`, `perf`
- **scope**: the area you worked on, e.g. `pdf`, `engines`, `ui`, `i18n`, `server`
- **description**: short and imperative, e.g. `fix(pdf): keep page rotation when splitting`

## Pull requests

Keep each pull request focused on one change, fill in the template, and make sure `npm test` passes. By contributing you agree that your work is released under the [MIT license](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
