# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub instead:

1. Go to the [Security tab](https://github.com/azammarchi/shiftdeck/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it and what an attacker could do with it.

You'll get a reply as soon as possible. Once a fix is out, the report can be made public, with credit to you if you'd like.

## Supported versions

Only the latest version on the `main` branch receives fixes.

## How Shiftdeck protects your files

- The server listens only on `127.0.0.1`, answers only requests addressed to `localhost` (which defeats DNS rebinding) and refuses requests that pages on other sites send. Running a tool needs a JSON request, which another site can't send without a CORS preflight that the server never allows.
- Uploads and results are stored under random names in a temporary folder only your user can open (mode 700), deleted when the server stops.
- Converters are always run with an argument list, never through a shell, so a file name can't become a command.
- Passwords never appear on a command line, where other users of the computer could see them with `ps`: PDFKit gets them through an environment variable, qpdf through a JSON job file only your user can read, deleted right after.
- The online demo (GitHub Pages) has no server: the tools it offers run inside the page, and files never leave the browser.
- Without qpdf (only possible on macOS), PDF passwords use RC4 128-bit, the most PDFKit can write. It is weak, and the app says so.
- `npm run setup` installs engines only from the system's own package manager (Homebrew, apt, dnf, pacman, zypper, winget, Chocolatey), never from downloads of its own.

## Scope

Relevant reports include, for example:

- a way for a web page to reach the local server, read your files or results, or run a tool;
- a crafted file or file name that makes the server or an engine run a command, or read or write files outside its temporary folder and `public/`;
- passwords leaking to other users or processes, or being written to disk outside the short-lived arguments file;
- results that claim a protection they don't have.
