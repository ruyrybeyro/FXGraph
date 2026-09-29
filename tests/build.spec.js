const { test, expect } = require("@playwright/test");
const { execSync, spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ROOT = path.join(__dirname, "..");
const PORT = 4174;

let server;

test.beforeAll(async () => {
    execSync("node scripts/build.js", { cwd: ROOT, stdio: "pipe" });

    server = spawn("python3", ["-m", "http.server", String(PORT)], {
        cwd: path.join(ROOT, "dist"),
        stdio: "ignore",
    });

    // Wait for the server to actually be accepting connections
    await new Promise((resolve, reject) => {
        let attempts = 0;
        let tryConnect = () => {
            http
                .get(`http://localhost:${PORT}/`, (res) => {
                    res.resume();
                    resolve();
                })
                .on("error", () => {
                    attempts++;
                    if (attempts > 50) return reject(new Error("dist server never came up"));
                    setTimeout(tryConnect, 100);
                });
        };
        tryConnect();
    });
});

test.afterAll(() => {
    server?.kill();
});

test("the built dist/ output loads with no 404s or console errors", async ({ page }) => {
    await page.route("**/api/candles/twelvedata**", (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "ok",
                values: [{ datetime: "2026-09-21", open: "1", high: "2", low: "0.5", close: "1.5" }],
            }),
        })
    );

    const missing = [];
    const errors = [];
    page.on("response", (res) => {
        if (res.status() === 404) missing.push(res.url());
    });
    page.on("pageerror", (e) => errors.push(e));

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "networkidle" });
    await page.click("#candleToggleBtn");
    await page.waitForTimeout(500);

    expect(missing).toHaveLength(0);
    expect(errors).toHaveLength(0);
    await expect(page.locator("#dataSourceLabel")).toHaveText(/^Twelve Data OHLC Chart · SMA\(\d+\)$/);
});

test("built filenames are content-hashed and referenced consistently", async ({ page }) => {
    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: "domcontentloaded" });

    let scriptSrc = await page.locator('script[type="module"]').getAttribute("src");
    expect(scriptSrc).toMatch(/^js\/main\.[0-9a-f]{10}\.js$/);

    let cssHref = await page.locator('link[rel="stylesheet"][href*="css/main"]').getAttribute("href");
    expect(cssHref).toMatch(/^css\/main\.[0-9a-f]{10}\.css$/);
});

// Regression test: adding a new import to main.js without also adding its
// source path to build.js's JS_LEAVES used to build "successfully" (exit
// 0) while silently shipping a reference to a file that was never copied
// into dist/ - a 404 that would only surface much later, in the browser.
// Placed last in this file since it deliberately mutates js/main.js and
// dist/ for the duration of the check, restoring both immediately after
// (tests within a file run sequentially by default, so this doesn't race
// the other tests above, which only read the already-built dist/).
test("the build fails loudly (not silently) on an import build.js doesn't know about", async () => {
    let mainPath = path.join(ROOT, "js/main.js");
    let newFeaturePath = path.join(ROOT, "js/newFeature.js");
    let originalMain = fs.readFileSync(mainPath, "utf8");

    try {
        fs.writeFileSync(newFeaturePath, "export function newFeature() {}\n");
        fs.writeFileSync(
            mainPath,
            `import { newFeature } from "./newFeature.js";\n${originalMain}`
        );

        expect(() => execSync("node scripts/build.js", { cwd: ROOT, stdio: "pipe" })).toThrow();
    } finally {
        fs.writeFileSync(mainPath, originalMain);
        fs.rmSync(newFeaturePath, { force: true });
        // Leave dist/ correctly rebuilt regardless of pass/fail above
        execSync("node scripts/build.js", { cwd: ROOT, stdio: "pipe" });
    }
});
