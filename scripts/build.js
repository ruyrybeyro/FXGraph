#!/usr/bin/env node

/**
 * Minimal, dependency-free build step: copies the app into dist/ with
 * every CSS/JS file renamed to include a content hash
 * (e.g. main.a1b2c3d4e5.js), and rewrites every reference to those files
 * (in index.html, and in js/main.js's import statements) to match.
 *
 * Why: without this, a deploy can only be picked up by browsers that
 * either revalidate on every load (see nginx/static-cache.conf.example's
 * old no-cache approach) or by manually clearing the cache - both of
 * which have already caused real confusion this project's history.
 * Content-hashed filenames make staleness structurally impossible: a
 * changed file is a genuinely different URL, so there's nothing to cache
 * that could ever go stale. Deployed files can then be cached hard and
 * long (immutable); only index.html itself needs to stay no-cache, since
 * it's the one file whose content changes without a new filename.
 *
 * Deliberately not a bundler - it doesn't concatenate or minify anything,
 * just renames files and fixes up the references between them, so the
 * deployed code stays exactly as readable as the source.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");

// Leaf JS modules main.js imports - none of these import each other, so
// they can all be hashed independently before main.js is rewritten and
// hashed itself. Keeping this list explicit (not just running `find`)
// makes it obvious what a modified main.js needs to also update here.
const JS_LEAVES = [
    "js/state.js",
    "js/utils/utils.js",
    "js/graph/graph.js",
    "js/graph/candleChart.js",
    "js/services/currencyService.js",
    "js/services/yahooService.js",
    "js/services/twelveDataService.js",
];

const VENDOR_FILES = ["js/vendor/lightweight-charts.standalone.production.js"];
const CSS_FILES = ["css/main.css"];
const ENTRY = "js/main.js";

function hashOf(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
}

function hashedName(relativePath, content) {
    let ext = path.extname(relativePath);
    let base = relativePath.slice(0, -ext.length);
    return `${base}.${hashOf(content)}${ext}`;
}

function writeOutput(relativePath, content) {
    let outPath = path.join(DIST, relativePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
}

function validateImportsResolve(outputRelativePath, source) {
    let importRegex = /from\s+["'](\.[^"']+)["']/g;
    let outputDir = path.dirname(path.join(DIST, outputRelativePath));
    let match;

    while ((match = importRegex.exec(source)) !== null) {
        let importPath = match[1];
        let resolved = path.join(outputDir, importPath);

        if (!fs.existsSync(resolved)) {
            throw new Error(
                `${outputRelativePath} imports "${importPath}", which doesn't exist in dist/ ` +
                    `(looked for ${resolved}). Either it's a new import in js/main.js whose source ` +
                    `path needs adding to JS_LEAVES in scripts/build.js, or it's a leaf module ` +
                    `(one of JS_LEAVES) importing another one - which this build script doesn't ` +
                    `rewrite/support yet, since none of them currently do.`
            );
        }
    }
}

function build() {
    fs.rmSync(DIST, { recursive: true, force: true });

    // manifest maps the original source-relative path (as written in
    // index.html/imports) to its hashed output path
    let manifest = {};

    for (let relativePath of [...JS_LEAVES, ...VENDOR_FILES, ...CSS_FILES]) {
        let content = fs.readFileSync(path.join(ROOT, relativePath));
        let outputPath = hashedName(relativePath, content);
        manifest[relativePath] = outputPath;
        writeOutput(outputPath, content);
    }

    // Leaves are copied as-is (none of them import each other today), but
    // verify that's still true rather than assuming it forever - if one
    // ever gains an import, it wouldn't be rewritten (only main.js's
    // imports are) and would otherwise ship a broken, unhashed reference
    // silently. This turns that into a build failure instead.
    for (let leaf of JS_LEAVES) {
        validateImportsResolve(manifest[leaf], fs.readFileSync(path.join(ROOT, leaf), "utf8"));
    }

    // Rewrite main.js's imports to point at the leaves' hashed filenames,
    // then hash the rewritten content
    let mainSource = fs.readFileSync(path.join(ROOT, ENTRY), "utf8");

    for (let leaf of JS_LEAVES) {
        // import paths in main.js are relative to js/, e.g. "./state.js"
        // or "./utils/utils.js" - matching against the leaf path with the
        // js/ prefix stripped
        let importPath = "./" + leaf.slice("js/".length);
        let hashedImportPath = "./" + manifest[leaf].slice("js/".length);

        mainSource = mainSource.split(`"${importPath}"`).join(`"${hashedImportPath}"`);
    }

    let mainOutputPath = hashedName(ENTRY, mainSource);
    manifest[ENTRY] = mainOutputPath;
    writeOutput(mainOutputPath, mainSource);

    // Verify every relative import in the file we just wrote actually
    // resolves to a real file in dist/ - catches the case where main.js
    // gains a new import that JS_LEAVES above wasn't updated for, which
    // would otherwise build "successfully" (exit 0) while silently
    // shipping a reference to a file that was never copied/hashed, only
    // surfacing as a 404 in the browser much later.
    validateImportsResolve(mainOutputPath, mainSource);

    // Rewrite index.html's references to the hashed filenames.
    // index.html itself is NOT hashed - it's the one file that must
    // always be re-fetched fresh to pick up new hashed references, so it
    // keeps a stable name and relies on no-cache instead.
    let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

    for (let [original, hashed] of Object.entries(manifest)) {
        html = html.split(`"${original}"`).join(`"${hashed}"`);
    }

    writeOutput("index.html", html);

    console.log("Built to dist/:");
    for (let [original, hashed] of Object.entries(manifest)) {
        console.log(`  ${original} -> ${hashed}`);
    }
}

try {
    build();
} catch (e) {
    console.error(`Build failed: ${e.message}`);
    process.exit(1);
}
