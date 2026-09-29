const { PNG } = require("pngjs");

// Decodes a real, composited screenshot and checks for a target color
// within a pixel region - needed to verify DOM overlay content (the
// indicator placeholders/name labels in candleChart.js), which isn't
// drawn on any <canvas> and so can't be checked via getImageData() the
// way the indicator *lines* are elsewhere in this test suite.
//
// This exists because two real bugs shipped past `toBeVisible()`: both
// the placeholders and the pane-name labels were, at different points,
// silently painted over by Lightweight Charts' own canvases despite
// passing every DOM-level check (display, visibility, opacity, a
// non-empty bounding rect) - toBeVisible() doesn't detect being
// occluded by a sibling, and elementFromPoint()/elementsFromPoint() both
// proved unusable here since they exclude pointer-events:none elements
// (which these overlays intentionally are, so they don't block chart
// interaction) rather than reporting true paint order. A real screenshot
// is the only check that actually reflects what's on screen.
function regionHasColor(pngBuffer, region, [targetR, targetG, targetB], tolerance = 20) {
    let png = PNG.sync.read(pngBuffer);

    let x1 = Math.max(0, Math.floor(region.x));
    let y1 = Math.max(0, Math.floor(region.y));
    let x2 = Math.min(png.width, Math.ceil(region.x + region.width));
    let y2 = Math.min(png.height, Math.ceil(region.y + region.height));

    for (let y = y1; y < y2; y++) {
        for (let x = x1; x < x2; x++) {
            let i = (png.width * y + x) << 2;
            let r = png.data[i];
            let g = png.data[i + 1];
            let b = png.data[i + 2];
            let a = png.data[i + 3];

            if (
                a > 0 &&
                Math.abs(r - targetR) <= tolerance &&
                Math.abs(g - targetG) <= tolerance &&
                Math.abs(b - targetB) <= tolerance
            ) {
                return true;
            }
        }
    }

    return false;
}

module.exports = { regionHasColor };
