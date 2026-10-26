// Draws numbered, coloured A4-sized PNG pages for the tests: osascript -l JavaScript draw-pages.jxa.js <outDir>
ObjC.import('AppKit');

function run(argv) {
  const dir = argv[0];
  const colors = [[0.9, 0.3, 0.25], [0.25, 0.4, 0.85], [0.2, 0.6, 0.4], [0.9, 0.7, 0.1], [0.75, 0.4, 0.8]];
  colors.forEach(([r, g, b], i) => {
    const w = 1240, h = 1754;
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, w, h, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep));
    $.NSColor.colorWithSRGBRedGreenBlueAlpha(r, g, b, 1).setFill;
    $.NSRectFill($.NSMakeRect(0, 0, w, h));
    // JXA doesn't bridge string constants: these are the values of NSFontAttributeName / NSForegroundColorAttributeName
    const attrs = $.NSMutableDictionary.dictionary;
    attrs.setObjectForKey($.NSFont.boldSystemFontOfSize(160), 'NSFont');
    attrs.setObjectForKey($.NSColor.whiteColor, 'NSColor');
    $(`Pagina ${i + 1}`).drawAtPointWithAttributes($.NSMakePoint(220, h / 2 - 80), attrs);
    $.NSGraphicsContext.restoreGraphicsState;
    const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
    png.writeToFileAtomically(`${dir}/p${i + 1}.png`, true);
  });
}
