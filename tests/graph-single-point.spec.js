const { test, expect } = require("@playwright/test");

// Regression test: a chart with exactly one data point (e.g. a very
// sparse date range) divided by zero in Graph.drawClient's stepX
// calculation (graphWidth / (labels.length - 1), with labels.length
// === 1), leaving stepX as Infinity. The "can't be less than one pixel"
// guard didn't catch it (Infinity < 1 is false), so it silently
// propagated into dataIndex * Infinity = NaN hover/touch coordinates -
// canvas draw calls with non-finite coordinates are a spec'd no-op, so
// the crosshair silently never rendered at all for a single-point chart.
test("hovering a single-data-point chart does not silently fail to draw the crosshair", async ({
    page,
}) => {
    // 2 dates: updateLineData pops the latest one off, leaving exactly 1
    // for the chart - the degenerate case.
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rates: {
                    "2026-09-18": { PHP: 58.2 },
                    "2026-09-21": { PHP: 58.7 },
                },
            }),
        })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.waitForTimeout(500);

    let countNonWhitePixels = () =>
        page.evaluate(() => {
            let c = document.getElementById("graph");
            let ctx = c.getContext("2d");
            let d = ctx.getImageData(0, 0, c.width, c.height).data;
            let nonWhite = 0;
            for (let i = 0; i < d.length; i += 4) {
                if (!(d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255)) nonWhite++;
            }
            return nonWhite;
        });

    // Canvas text drawn before a web font finishes loading renders with a
    // fallback font and never gets retroactively corrected (canvas is a
    // fixed bitmap, unlike DOM text). The chart's very first draw can land
    // before "Inter" is ready, giving it a different pixel footprint than
    // every later redraw - capturing "baseline" straight after goto() risked
    // comparing against that one-off fallback-font render instead of the
    // steady state every other snapshot in this test reflects. Forcing one
    // redraw after fonts have settled first avoids that mismatch.
    await page.evaluate(() =>
        document.fonts.ready.then(() => window.dispatchEvent(new Event("resize")))
    );
    await page.waitForTimeout(100);

    let box = await page.locator("#graph").boundingBox();
    let baseline = await countNonWhitePixels();

    // Polled rather than a fixed sleep - under parallel-worker CPU load, a
    // flat wait can sample before the mousemove handler's redraw actually
    // lands, making a real crosshair draw look like a no-op (flaky fail).
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(countNonWhitePixels).not.toBe(baseline);

    await page.mouse.move(box.x - 100, box.y - 100);
    await expect.poll(countNonWhitePixels).toBe(baseline);

    expect(pageErrors).toHaveLength(0);
});
