# Accessibility

Shiftdeck aims to be usable by everyone, whether you use a mouse, a keyboard or a screen reader. The target is [WCAG 2.1](https://www.w3.org/TR/WCAG21/) level AA.

## What's supported

- **Everything works from the keyboard.** The tools are radio buttons (arrows move between them), files are added with a regular button and file picker, each file's **Move up**, **Move down** and **Remove** buttons are reachable with `Tab`, and `Enter` in an option field runs the tool. After moving a file, the focus stays on it.
- **Screen readers** get a name for every control, including icon-only buttons (named after the file they act on), and hear the progress and outcome of every conversion through a status message.
- **Contrast**: text meets the 4.5:1 ratio, including on the colored button.
- **Visible focus**: a clear outline shows where the keyboard is.
- **Reduced motion**: with "reduce motion" turned on, the app drops its transitions.
- **Languages**: English and Italian, with the page language set for screen readers.

## How it's checked

Every push runs [axe-core](https://github.com/dequelabs/axe-core) WCAG 2.1 AA checks on every tool, on a list with an invalid file and an error, and on the results, in WebKit, Firefox and Chromium, together with a test that does a whole conversion from the keyboard. See [`tests/a11y.spec.js`](tests/a11y.spec.js).

## Known limitations

- **No manual screen reader testing yet.** The app passes automated checks, but it hasn't been tried end to end with VoiceOver, NVDA or Orca by someone who uses it every day. Reports are especially welcome here.
- **Drag and drop** of files from your file manager is mouse-only; the **Choose files** button does the same from the keyboard.

## Reporting a barrier

If something gets in your way, please [open an issue](https://github.com/azammarchi/shiftdeck/issues/new/choose) and mention the browser, the assistive technology you use (if any) and what you were trying to do. Accessibility problems are treated as bugs.
