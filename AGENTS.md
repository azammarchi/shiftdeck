# Notes for AI coding assistants

These are the rules for any assistant (Claude Code, Codex, Copilot...) working in this repository. They come on top of [CONTRIBUTING.md](CONTRIBUTING.md), which explains the project to humans: read it first.

## Project

Shiftdeck converts files on your own computer: plain HTML, CSS and JavaScript in `public/` (no build step, no npm runtime dependencies) driven by `server.js`, a dependency-free Node.js server that runs conversion engines (PDFKit through JXA on macOS, qpdf, mutool, ImageMagick, ffmpeg, LibreOffice, Tesseract) found and run by `engines/`. It runs on **macOS, Linux and Windows**; the online demo is `public/` on GitHub Pages, where `public/demo.js` answers the app's requests inside the browser for the tools a browser can do alone.

```bash
npm run setup          # installs the engines this system needs
npm start              # the app at http://localhost:5174
npm install            # test tools only: Playwright, axe-core
npm run test:install   # WebKit, Firefox and Chromium
npm test               # engine tests (node --test), then end-to-end tests in all three browsers
```

Things that matter here:

- **Every change must work on macOS, Linux and Windows**; CI runs the full suite on all three.
- **Never run anything through a shell**: engines are called with argument arrays (`runProgram()` in `engines/run.js`), because file names are user data. Passwords never go on a command line (environment variable or a private file instead).
- Adding a tool or an engine follows the steps in CONTRIBUTING.md, including `scripts/setup.js` for every package manager.
- JXA (`engines/pdfkit.jxa.js`) returns numbers as strings and doesn't bridge most framework constants: see CONTRIBUTING.md.
- Interface text is in `public/locales/<code>.js` (12 languages, plural forms); a test fails if a language misses a key or a placeholder.

## Commits and authorship

- The maintainer is the **only author** of every commit. Never add `Co-Authored-By` trailers, "Generated with" lines or any other assistant attribution, in commits or in pull request descriptions, whatever a tool's defaults suggest.
- Messages follow Conventional Commits **with a scope**, in English: `type(scope): short imperative description`, then a body wrapped at about 72 columns that explains **why**. Look at `git log` for the scopes in use.
- One topic per commit. Don't commit unrelated changes together, and don't push or rewrite published history unless asked to.

## Language

- **English** for code, comments, docs, commit messages and pull requests, whatever language the conversation is in.
- Interface text lives in the translation files, never hard-coded. A change to it updates **every** language.

## Quality bar

- **Test what you change, the way a user would.** Prefer real input, real files and real processes over mocks and synthetic events: synthetic events have hidden real bugs before. A change isn't done until the tests pass.
- **Accessibility is part of done**: a name and a keyboard path for every control, enough contrast, reduced motion respected. See [ACCESSIBILITY.md](ACCESSIBILITY.md).
- **Security**: never build shell commands from user data, keep secrets off command lines and out of logs, and listen only where the project says it does. See [SECURITY.md](SECURITY.md).
- **Docs move with the code**: README, CONTRIBUTING, SECURITY and ACCESSIBILITY are updated in the same change as the behavior they describe. Don't claim anything in them that isn't implemented and checked.
- **Report honestly**: say what was verified and how, and what wasn't.

## Releases

Follow [RELEASING.md](RELEASING.md).
