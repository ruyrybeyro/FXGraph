const { test, expect, devices } = require("@playwright/test");

// Regression test: without touch-action: none on the candle chart's
// container, touch browsers (confirmed on Android/Chrome) treat a drag on
// the chart as a page-scroll gesture and never hand the touch events to
// Lightweight Charts, so its crosshair never tracks.
test.use({ ...devices["Pixel 7"] });

test("touch-dragging the candle chart does not scroll the page", async ({ page, context }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ok",
                values: [
                    { datetime: "2026-09-21", open: "58.2", high: "58.9", low: "58.0", close: "58.7" },
                    { datetime: "2026-09-18", open: "58.6", high: "59.0", low: "58.3", close: "58.2" },
                ],
            }),
        })
    );

    await page.goto("/");
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    let containerTouchAction = await page.evaluate(
        () => getComputedStyle(document.getElementById("candleChart")).touchAction
    );
    expect(containerTouchAction).toBe("none");

    let box = await page.locator("#candleChart").boundingBox();
    let client = await context.newCDPSession(page);

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: box.x + 100, y: box.y + 150 }],
    });
    await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: box.x + 200, y: box.y + 150 }],
    });
    await page.waitForTimeout(100);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

// Regression test: the line chart's hover tooltip only listened for
// mouse events (mouseenter/mousemove/mouseleave), which never fire from
// touch interaction - so unlike the candle view (handled by Lightweight
// Charts), it never worked on touch devices at all.
test("touching the line chart shows the crosshair tooltip and does not scroll the page", async ({
    page,
    context,
}) => {
    // 4 dates: updateLineData pops the latest one off (for "latest value"),
    // leaving 3 for the chart. A single remaining point would divide by
    // zero in Graph.drawClient's stepX calculation - see graph.js.
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                rates: {
                    "2026-09-15": { PHP: 58.0 },
                    "2026-09-18": { PHP: 58.2 },
                    "2026-09-20": { PHP: 58.5 },
                    "2026-09-21": { PHP: 58.7 },
                },
            }),
        })
    );

    await page.goto("/");
    await page.waitForTimeout(500);

    let touchAction = await page.evaluate(
        () => getComputedStyle(document.getElementById("graph")).touchAction
    );
    expect(touchAction).toBe("none");

    let box = await page.locator("#graph").boundingBox();
    let client = await context.newCDPSession(page);

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

    let baseline = await countNonWhitePixels();

    await client.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await page.waitForTimeout(150);

    let duringTouch = await countNonWhitePixels();
    expect(duringTouch).toBeGreaterThan(baseline); // crosshair + tooltip drawn

    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(150);

    let afterRelease = await countNonWhitePixels();
    expect(afterRelease).toBeLessThan(duringTouch); // crosshair cleared
});
