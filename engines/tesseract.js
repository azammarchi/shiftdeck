// Engine: Tesseract OCR (https://github.com/tesseract-ocr/tesseract), on
// macOS, Linux and Windows. Reads the text in pictures of pages.
//
// Its language models live in data/tessdata, the same set on every system:
// `npm run setup` downloads them from Tesseract's own repository, pinned to a
// release and checked against the SHA-256 below, since package managers
// ship different languages (Homebrew and the Windows installer only English).
const fs = require('fs');
const path = require('path');
const { findProgram, runProgram, ToolError } = require('./run');

const TESSDATA = process.env.SHIFTDECK_TESSDATA || path.join(__dirname, '..', 'data', 'tessdata');
const MODELS_URL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0';

// The "fast" models of tessdata_fast 4.1.0, for the app's languages.
const MODELS = {
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  ita: 'b8f89e1e785118dac4d51ae042c029a64edb5c3ee42ef73027a6d412748d8827',
  spa: '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464',
  fra: 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca',
  deu: '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d',
  por: 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb',
  rus: 'e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225',
  chi_sim: 'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730',
  jpn: '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d',
  kor: '6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2',
  hin: '4c73ffc59d497c186b19d1e90f5d721d678ea6b2e277b719bee4e2af12271825',
  ara: 'e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729',
};

const program = () => findProgram('tesseract');

// The models that are there, in MODELS' order.
function languages() {
  return Object.keys(MODELS).filter((lang) => fs.existsSync(path.join(TESSDATA, `${lang}.traineddata`)));
}

// Reads `image` (a picture of one page, at `dpi`) into `<outBase>.pdf` or
// `<outBase>.txt`. With `textOnly`, the PDF holds just the invisible text,
// to lay over the original page.
async function recognize(image, outBase, { langs, format, textOnly = false, dpi = 300, signal }) {
  const file = program();
  if (!file) throw new ToolError('noEngine', 'Tesseract is not installed: run npm run setup');
  const args = [image, outBase, '--tessdata-dir', TESSDATA, '-l', langs.join('+'), '--dpi', String(dpi)];
  if (textOnly) args.push('-c', 'textonly_pdf=1');
  args.push(format);
  const { code, stderr } = await runProgram(file, args, { signal });
  if (signal?.aborted) throw new ToolError('cancelled', 'cancelled');
  if (code !== 0) throw new ToolError('failed', stderr.trim().split('\n').pop() || 'Tesseract could not read the page');
}

module.exports = { available: () => !!program() && languages().length > 0, languages, recognize, TESSDATA, MODELS, MODELS_URL };
