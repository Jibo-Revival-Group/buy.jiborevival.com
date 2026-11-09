// node scraper/near.test.mjs (from the repo root) — Near me in the real page, with the IP lookup and listings stubbed.
import { chromium } from 'playwright';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const listings = { updated: new Date().toISOString(), sources: {}, listings: [
    { id: 'facebook:1', source: 'facebook', title: 'Jibo Social Robot', location: 'Morristown, NJ', firstSeen: '2026-11-01T00:00:00Z' },
    { id: 'facebook:2', source: 'facebook', title: 'Jibo robot', location: 'Boston, MA', firstSeen: '2026-11-01T00:00:00Z' },
    { id: 'facebook:3', source: 'facebook', title: 'Sealed Jibo', location: 'Ships to you', firstSeen: '2026-11-01T00:00:00Z' },
    { id: 'ebay:1', source: 'ebay', title: 'Jibo Social Robot', location: 'United States', firstSeen: '2026-11-01T00:00:00Z', hotness: 7 },
    { id: 'craigslist:1', source: 'craigslist', title: 'Brand new jibo', location: 'Morris Plains', firstSeen: '2026-11-01T00:00:00Z', hotness: -3 }] };

async function open(b, geo) {
    const p = await b.newPage();
    await p.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.hostname === 'get.geojs.io') return geo ? route.fulfill({ json: geo }) : route.abort();
        if (u.hostname === 'api.5x1.com' && u.pathname === '/jibo-listings') return route.fulfill({ json: listings });
        if (u.hostname !== 'buy.test') return route.abort();
        const f = u.pathname === '/' ? 'index.html' : u.pathname.slice(1);
        return route.fulfill({ body: fs.readFileSync(path.join(root, f)), contentType: f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await p.goto('http://buy.test/'); await p.waitForTimeout(800);
    return p;
}
const titles = p => p.$$eval('.card h3', hs => hs.map(h => h.closest('a').getAttribute('aria-label').split(',')[0] + '@' + h.closest('a').querySelector('.meta span') ?.textContent));

const b = await chromium.launch();
try {
    const ma = await open(b, { country_code: 'US', region: 'Massachusetts' });
    assert.strictEqual(await ma.textContent('#near'), 'Near me · MA');
    assert.strictEqual(await ma.getAttribute('#near', 'aria-pressed'), 'true', 'on by default');
    let shown = await titles(ma);
    assert.strictEqual(shown.length, 4, shown); assert(!shown.some(t => /Morristown/.test(t)), 'NJ pickup hidden');
    assert(shown.some(t => /Ships to you/.test(t)) && shown.some(t => /Morris Plains/.test(t)), 'shipping FB and Craigslist kept');
    assert.strictEqual(await ma.textContent('.heat.hot'), '🔥 Hot +7', 'hot badge above 5');
    await ma.selectOption('#sort', 'hot');
    assert.strictEqual(await ma.textContent('.card h3'), 'Jibo Social Robot', 'hottest first');
    assert.strictEqual(await ma.locator('.card h3').nth(1).textContent(), 'Brand new jibo', 'a negative score still ranks above unscored listings');
    await ma.selectOption('#sort', 'new');
    await ma.click('#near');
    assert.strictEqual((await titles(ma)).length, 5, 'off shows everything');

    for (const geo of [null, { country_code: 'CA', region: 'Ontario' }]) {
        const p = await open(b, geo);
        assert(await p.isHidden('#near'), 'no state: no button'); assert.strictEqual((await titles(p)).length, 5);
    }
    console.log('PASS near me + hotness badge');
} finally { await b.close(); }
