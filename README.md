# FXGraph

A browser-based currency exchange rate chart. Pick any two currencies and a
time range to see a historical rate line chart, or switch to a candlestick
(OHLC) view of the same pair and range.

## Features

- Historical exchange rate line chart for any of 30 currency pairs
- Candlestick (OHLC) view for the same pair/range, toggled with the
  **Candles** button, with five technical indicators alongside the
  candles:
  - A moving-average (SMA) overlay whose period is adaptive by default
    and editable via the **SMA period** field
  - MACD (12/26/9), in its own pane below the candles
  - RSI (14), in its own pane with 30/70 reference lines
  - ADX (14) with +DI/-DI, in its own pane with a 25 reference line
  - RVI - Dorsey's Relative Volatility Index (10-period stdev, 14-period
    smoothing; not to be confused with the Relative Vigor Index, a
    different, similarly-abbreviated indicator), in its own pane with a
    50 reference line
    (VWAP was considered too, but dropped - neither Twelve Data nor
    Yahoo Finance reliably reports volume for FX pairs, an OTC market
    with no central exchange, so a volume-weighted average would be
    either unavailable or misleading)

  MACD, ADX, and RVI use fixed, conventional periods rather than an
  adaptive one (unlike the SMA overlay) - so a range with fewer candles
  than an indicator needs shows a small placeholder in its pane ("MACD
  needs 26+ candles (have 21) - try a longer range") instead of a
  silently blank area. Each indicator pane also carries a small name
  label (e.g. "RSI (14)"), since the price-scale numbers alone don't
  say which indicator a pane is.
- Time ranges: 1W, 1M, 1Y (default), 2Y, 5Y, 10Y - 1Y rather than 1M so
  real (weekday-only) FX data comfortably clears every indicator's
  minimum candle count from the first paint
- Period % change shown next to the current rate
- Searchable From/To currency pickers, with a swap button to flip the pair
- Hover (or touch-drag, on mobile) the chart for the exact rate/OHLC
  values at a given date
- Your last-used pair, range, view mode, and SMA period are remembered
  (via `localStorage`) and restored on your next visit

## Where the data comes from

### Exchange rate line chart — Frankfurter

`js/services/currencyService.js` calls the [Frankfurter API](https://frankfurter.dev)
(`https://api.frankfurter.dev/v1`) directly from the browser. It's free,
requires no API key, and sends proper CORS headers, so no proxy is needed
for this part of the app.

Frankfurter republishes ECB reference rates, which currently cover 30
currencies. The From/To dropdowns in `index.html` are intentionally limited
to exactly that list — a few currencies the ECB no longer publishes rates
for (e.g. Croatia's kuna, retired when it adopted the euro) are left out
rather than silently failing.

### Candlestick (OHLC) data — Twelve Data, with Yahoo Finance as fallback

`js/main.js` fetches candles in this order:

1. **Twelve Data** (`js/services/twelveDataService.js`) is tried first — an
   official, documented forex API with a real free-tier quota (800
   requests/day). Requires an API key.
2. If that fails (quota exhausted, error, or no data), it falls back to
   **Yahoo Finance**'s unofficial chart API
   (`js/services/yahooService.js`). This has no official quota but is
   prone to rate-limiting, especially from datacenter/VPS IP ranges.

Candles are rendered with [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts),
vendored locally at `js/vendor/lightweight-charts.standalone.production.js`
(no CDN dependency) and wrapped by `js/graph/candleChart.js`. The line
chart is unrelated hand-rolled canvas code in `js/graph/graph.js`.

**Neither Twelve Data nor Yahoo Finance sends CORS headers**, so the
browser can't call them directly — both are fetched through a same-origin
reverse proxy instead. See [Running the candle view](#running-the-candle-view-requires-a-proxy) below.

## Project structure

```
index.html                  Page markup: currency pickers, date range buttons, chart containers
css/main.css                Styling

js/main.js                  DOM wiring and fetch orchestration
js/state.js                 App state (mode, selected range, request tracking, line-chart cache)
js/utils/utils.js           Date formatting, currency search-filter matching

js/services/currencyService.js    Frankfurter API client (line chart)
js/services/twelveDataService.js  Twelve Data API client (candles, primary)
js/services/yahooService.js       Yahoo Finance API client (candles, fallback)

js/graph/graph.js           Hand-rolled canvas line chart
js/graph/candleChart.js     Lightweight Charts wrapper (candlestick view)
js/vendor/                  Vendored third-party libraries (Lightweight Charts)

scripts/build.js             Build step - see Deploying below
nginx/candle-proxy.conf.example   Reverse proxy config for the candle data sources
nginx/static-cache.conf.example   Browser cache policy for the built dist/ output

tests/                       Playwright test suite (dev-only, see Testing below)
```

## Running it locally

No build needed for local development — the raw source is a working
static site on its own, since Frankfurter can be called directly from the
browser:

```
python3 -m http.server 8000
```

then open `http://localhost:8000`.

### Running the candle view locally (requires a proxy)

The **Candles** toggle needs `/api/candles/twelvedata` and `/api/yahoo/`
to be served from the same origin as the page. `nginx/candle-proxy.conf.example`
has the full config and setup notes. In short:

1. Get a free API key from [twelvedata.com](https://twelvedata.com).
2. Copy the two `location` blocks from `nginx/candle-proxy.conf.example`
   into the nginx server block already serving this site, and the
   `proxy_cache_path` line into the surrounding `http {}` context.
3. Replace `YOUR_TWELVE_DATA_API_KEY` with your real key (it stays
   server-side and never reaches the browser).
4. `nginx -t && nginx -s reload`.

Without the proxy in place, the line chart still works; the Candles view
will just have no data source to fall back on.

## Deploying

`scripts/build.js` copies the app into `dist/`, renaming every CSS/JS file
to include a content hash (`main.a1b2c3d4e5.js`) and rewriting every
reference to match, so a changed file is *by construction* a different
URL — there's nothing for a browser to have a stale copy of. This is what
fixed a real incident where an old cached `main.js` kept running after a
deploy and threw confusing errors against the *current* API responses.

```
npm install
npm run build
```

Deploy the contents of `dist/` (not the raw source tree) — e.g. `scp -r
dist/* user@host:/path/to/webroot/`. Then apply
`nginx/static-cache.conf.example`'s cache policy, which depends on those
hashed filenames: `index.html` stays `no-cache` (it's the one file that
must always be re-fetched to pick up new hashed references), everything
else is cached hard and treated as immutable.

The `nginx/candle-proxy.conf.example` locations are unaffected by any of
this — they're reverse-proxy routes, not static files, so they don't move
when you switch from serving source to serving `dist/`.

## Testing

An automated test suite ([Playwright](https://playwright.dev)) covers the
regression-prone areas found during development — the same-currency guard,
keyboard navigation, the Twelve Data → Yahoo fallback chain, the line-chart
cache, a canvas-resize edge case, the CSP, and the build script itself
(against its actual `dist/` output). All API calls are mocked, so the
suite runs offline and deterministically.

```
npm install
npx playwright install chromium
npm test
```

This is dev-only tooling (`package.json`, `node_modules/`, `scripts/`,
`tests/`) — none of it is part of what gets deployed; only `dist/`'s
contents are.

## Known limitations

- Bulgarian lev (BGN), Croatian kuna (HRK), and Russian ruble (RUB) aren't
  in the currency lists — Frankfurter doesn't publish rates for them.
- The Yahoo Finance fallback can be rate-limited or blocked on some
  hosts' IP ranges, since it's an unofficial API with no real quota.

## Author

Rui Ribeiro + Claude
