const { test, expect } = require("@playwright/test");

// Regression test: if the very first Frankfurter load ever fails (network
// issue, CSP block, unexpected response shape - anything), Graph.data and
// Graph.labels stay null from construction. Graph's own mouseenter/
// mousemove/mouseleave listeners used to assume they were always
// populated by the time the user could interact with the canvas, so just
// hovering the (blank) chart crashed uncaught.
test("hovering the canvas when the initial load failed does not crash", async ({ page }) => {
    await page.route("**://api.frankfurter.dev/**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ message: "not found" }), // no .rates
        })
    );

    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/");
    await page.waitForTimeout(500);
    await expect(page.locator("#statusMessage")).toHaveText("Unable to load exchange rate data.");

    const box = await page.locator("#graph").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.move(box.x - 50, box.y - 50); // off the canvas, triggers mouseleave

    expect(pageErrors).toHaveLength(0);
});
