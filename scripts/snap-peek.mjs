// Snap and regression-test the Peek modal.
//
// Two modes:
//   node scripts/snap-peek.mjs           # snap-only (legacy: PNGs to /tmp/cp-snaps)
//   node scripts/snap-peek.mjs --test    # snap + assert; non-zero exit on regression
//
// What it asserts in --test mode:
//   (1) Frontend dev server reachable at http://127.0.0.1:5174 — if not, SKIP (exit 0).
//   (2) /agents loads and a Peek button exists — if not, SKIP (no live sessions).
//   (3) Clicking Peek opens role="dialog" aria-modal="true".
//   (4) The modal panel renders opaque: computed background-color alpha === 1.
//       (Modal.tsx contract: panel is bg-surface, not the bg-fg/30 scrim.)
//   (5) At least one POST /api/sessions/<id>/peek returns 200 (no 403 — guards the
//       Vite changeOrigin / CSRF allow-list fix from CP1).
//
// Skips, not failures, when the backend is unreachable. Returns non-zero only on
// a real regression (modal transparent, peek POST 4xx/5xx, modal didn't open).

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { argv, exit } from 'node:process';

const BASE = 'http://127.0.0.1:5174';
const OUT  = '/tmp/cp-snaps';
const TEST_MODE = argv.includes('--test');

await mkdir(OUT, { recursive: true });

/**
 * Parse a CSS color string and return its alpha channel (0..1).
 * Accepts rgb(), rgba(), and hex (#rgb / #rrggbb / #rrggbbaa).
 * Returns 1 for any opaque format, the actual alpha for rgba/hex-with-alpha.
 * Returns null if the string can't be parsed (treat as unknown, not opaque).
 */
function parseAlpha(color) {
  if (!color) return null;
  const s = String(color).trim().toLowerCase();
  // rgb(r, g, b) — implicitly opaque
  const rgbMatch = s.match(/^rgb\(\s*[\d.]+\s*[, ]\s*[\d.]+\s*[, ]\s*[\d.]+\s*\)$/);
  if (rgbMatch) return 1;
  // rgba(r, g, b, a) or rgb(r g b / a)
  const rgbaMatch = s.match(/^rgba?\(.+[,/]\s*([\d.]+)\s*\)$/);
  if (rgbaMatch) return Number(rgbaMatch[1]);
  // hex
  if (s.startsWith('#')) {
    if (s.length === 9) return parseInt(s.slice(7, 9), 16) / 255; // #rrggbbaa
    if (s.length === 5) return parseInt(s.slice(4, 5).repeat(2), 16) / 255; // #rgba
    return 1; // opaque hex
  }
  return null;
}

/**
 * One pass over a theme. Returns a result envelope:
 *   { theme, skipped: 'no-backend' | 'no-sessions' | null, errors: string[], info: {...} }
 */
async function runTheme(browser, theme) {
  const result = { theme, skipped: null, errors: [], info: {} };
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
    storageState: {
      cookies: [],
      origins: [{ origin: BASE, localStorage: [{ name: 'gascity:theme', value: theme }] }],
    },
  });
  const page = await ctx.newPage();
  const apiCalls = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/')) {
      apiCalls.push({ url: r.url(), method: r.request().method(), status: r.status() });
    }
  });

  try {
    try {
      await page.goto(`${BASE}/agents`, { waitUntil: 'domcontentloaded', timeout: 5_000 });
    } catch (err) {
      if (String(err).includes('ERR_CONNECTION_REFUSED') || String(err).includes('net::ERR') || String(err).includes('NS_ERROR')) {
        result.skipped = 'no-backend';
        return result;
      }
      throw err;
    }
    await page.waitForSelector('header', { timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const peekBtn = page.getByRole('button', { name: /^peek/i }).first();
    if ((await peekBtn.count()) === 0) {
      result.skipped = 'no-sessions';
      const snapPath = `${OUT}/${theme}-agents-peek.png`;
      await page.screenshot({ path: snapPath });
      result.info.snap = snapPath;
      return result;
    }

    await peekBtn.click();

    // Wait for the modal to appear, then for the peek response to settle.
    const dialog = page.locator('div[role="dialog"][aria-modal="true"]');
    try {
      await dialog.waitFor({ state: 'visible', timeout: 3_000 });
    } catch {
      result.errors.push('modal did not appear after clicking Peek');
    }

    // Give the POST /peek a chance to round-trip.
    await page.waitForTimeout(1500);

    // Read computed background-color on the inner panel (first child of dialog).
    // The outer dialog div is the scrim (bg-fg/30); the inner div is bg-surface.
    if (await dialog.count() > 0) {
      const panelBg = await dialog.evaluate((node) => {
        const inner = node.firstElementChild;
        if (!(inner instanceof HTMLElement)) return null;
        return getComputedStyle(inner).backgroundColor;
      });
      result.info.panelBg = panelBg;
      const alpha = parseAlpha(panelBg);
      result.info.panelAlpha = alpha;
      if (alpha === null) {
        result.errors.push(`could not parse modal panel background-color: ${panelBg}`);
      } else if (alpha < 0.99) {
        result.errors.push(`modal panel not opaque: alpha=${alpha} (background=${panelBg})`);
      }
    }

    // Assertion: at least one POST /peek returned 200.
    const peekCalls = apiCalls.filter(
      (c) => c.method === 'POST' && /\/api\/sessions\/[^/]+\/peek$/.test(c.url),
    );
    result.info.peekCalls = peekCalls;
    if (peekCalls.length === 0) {
      result.errors.push('no POST /api/sessions/<id>/peek was observed');
    } else if (!peekCalls.some((c) => c.status === 200)) {
      const summary = peekCalls.map((c) => `${c.status} ${c.url}`).join('; ');
      result.errors.push(`no successful (200) /peek response. Saw: ${summary}`);
    }

    const snapPath = `${OUT}/${theme}-agents-peek.png`;
    await page.screenshot({ path: snapPath });
    result.info.snap = snapPath;
    result.info.apiCalls4xx = apiCalls.filter((c) => c.status >= 400);
  } finally {
    await ctx.close();
  }

  return result;
}

const browser = await chromium.launch();
const results = [];
try {
  for (const theme of ['light', 'dark']) {
    results.push(await runTheme(browser, theme));
  }
} finally {
  await browser.close();
}

// Report.
let hadErrors = false;
for (const r of results) {
  if (r.skipped === 'no-backend') {
    console.log(`[${r.theme}] SKIP — frontend not reachable at ${BASE}`);
    continue;
  }
  if (r.skipped === 'no-sessions') {
    console.log(`[${r.theme}] SKIP — no Peek button found (no active sessions)`);
    if (r.info.snap) console.log(`[${r.theme}] snap ${r.info.snap}`);
    continue;
  }
  if (r.info.snap) console.log(`[${r.theme}] snap ${r.info.snap}`);
  if (r.info.panelBg !== undefined) {
    console.log(`[${r.theme}] panel bg=${r.info.panelBg} alpha=${r.info.panelAlpha}`);
  }
  if (r.info.peekCalls?.length) {
    for (const c of r.info.peekCalls) console.log(`[${r.theme}] peek: ${c.status} ${c.url}`);
  }
  if (r.info.apiCalls4xx?.length) {
    console.log(`[${r.theme}] 4xx/5xx API calls:`, r.info.apiCalls4xx);
  }
  if (r.errors.length) {
    hadErrors = true;
    for (const e of r.errors) console.error(`[${r.theme}] FAIL — ${e}`);
  } else if (TEST_MODE) {
    console.log(`[${r.theme}] PASS`);
  }
}

if (TEST_MODE) {
  if (hadErrors) {
    console.error('peek regression: FAILED');
    exit(1);
  }
  const ranAny = results.some((r) => r.skipped === null);
  if (!ranAny) {
    const reason = results.every((r) => r.skipped === 'no-backend')
      ? 'no live frontend'
      : 'no active sessions to peek';
    console.log(`peek regression: SKIPPED (${reason})`);
    exit(0);
  }
  console.log('peek regression: PASSED');
}
