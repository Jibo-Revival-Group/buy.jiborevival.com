// Scrapes Jibo listings from eBay, Mercari, Facebook Marketplace, Craigslist and Poshmark into ../listings.json
// (local state, not committed); publish.sh uploads it to BEefy, which serves it to the site at /jibo-listings.
// eBay and Mercari block headless browsers, so run it headed under Xvfb:  xvfb-run -a node scraper/scrape.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'listings.json');
// 500-mile Marketplace searches around these cities cover the lower 48 (Facebook shows some results logged out).
const FB_CITIES = ['boston', 'nyc', 'atlanta', 'miami', 'chicago', 'dallas', 'denver', 'phoenix', 'la', 'sanfrancisco', 'seattle', 'minneapolis'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A real Jibo or Jibo part. Plenty of other things are called Jibo (Cartoni camera jibs, Funko "Jibo Jones", K9F...-JIBO flash
// chips, books, CDs, the Jibo Kannon statue, Tekno "Jibo Kie" toys), so a Jibo word is required unless the title is just "jibo".
const NOT_JIBO = /cartoni|\bjib\b|funko|jones|k9f|\bbga\b|\bchip\b|novel|hardback|paperback|\bcd\b|jacket|kan-?non|statue|acrylic|keychain|ghibli|postcard|dialogue|microphone|enping|baje|hikari|lychee|mschf|advertising|personali[sz]ed|tekno|dinkie|kie mom|wind[- ]?up|photocard|polaroid|\bpob\b|jiu sua/i;
const JIBO_WORD = /robot|social|charg|power|adapter|cord|cable|\bbase\b|\bparts?\b|motherboard|board|shell|battery|\b201[4-9]\b/i;
export function isJibo(title) {
    return /\bjibo\b/i.test(title) && !NOT_JIBO.test(title) &&
        (JIBO_WORD.test(title) || /^\s*(brand\s+)?(new\s+|used\s+)?jibo('?s)?\s*$/i.test(title));
}
export function price(text) {
    const m = String(text || '').replace(/,/g, '').match(/\$\s*(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
}

async function ebay(ctx) {
    const p = await ctx.newPage();
    await p.goto('https://www.ebay.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(3000);
    await p.goto('https://www.ebay.com/sch/i.html?_nkw=jibo&_ipg=240', { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(5000);
    const rows = await p.evaluate(() => [...document.querySelectorAll('li.s-card, li.s-item')].map(li => {
        const a = li.querySelector('a[href*="/itm/"]'), img = li.querySelector('img');
        const title = (li.querySelector('.s-card__title, .s-item__title') || {}).innerText || '';
        const priceText = (li.querySelector('.s-card__price, .s-item__price') || {}).innerText || '';
        const where = [...li.querySelectorAll('.s-card__attribute-row, .s-item__location')].map(e => e.innerText).find(t => /^(located in|from) /i.test(t)) || '';
        return a && { url: a.href.split('?')[0], title, priceText, image: img && (img.getAttribute('data-defer-load') || img.src), location: where.replace(/^(located in|from) /i, '') };
    }).filter(Boolean));
    await p.close();
    return rows.map(r => ({ ...r, title: r.title.replace(/\s*Opens in a new window or tab\s*$/i, '').replace(/^New Listing\s*/i, '').trim(),
        id: 'ebay:' + (r.url.match(/\/itm\/(\d+)/) || [])[1] })).filter(r => r.id !== 'ebay:undefined' && r.id !== 'ebay:123456');
}

async function mercari(ctx) {
    const p = await ctx.newPage(); let data = null;
    p.on('response', async r => { if (/operationName=searchFacetQuery/.test(r.url())) { try { data = await r.json(); } catch (e) {} } });
    await p.goto('https://www.mercari.com/search/?keyword=jibo&itemStatuses=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let i = 0; i < 30 && !data; i++) await sleep(500);
    await p.close();
    if (!data) throw new Error('no search response');
    return (data.data.search.itemsList || []).filter(i => i.status === 'on_sale').map(i => ({
        id: 'mercari:' + i.id, url: 'https://www.mercari.com/us/item/' + i.id + '/', title: i.name,
        priceText: '$' + (i.price / 100).toFixed(2), image: i.photos && i.photos[0] && i.photos[0].thumbnail, location: ''
    }));
}

async function facebook(ctx) {
    const seen = new Map();
    for (const city of FB_CITIES) {
        const p = await ctx.newPage();
        try {
            await p.goto(`https://www.facebook.com/marketplace/${city}/search?query=jibo&radius=805`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(7000);
            const rows = await p.evaluate(() => [...document.querySelectorAll('a[href*="/marketplace/item/"]')].map(a => ({
                url: a.href.split('?')[0], lines: a.innerText.split('\n').map(s => s.trim()).filter(Boolean), image: (a.querySelector('img') || {}).src })));
            for (const r of rows) {
                const id = 'facebook:' + (r.url.match(/item\/(\d+)/) || [])[1];
                const priceText = r.lines.find(l => /^\$|^free$/i.test(l)) || '';
                const rest = r.lines.filter(l => l !== priceText && !/^\$/.test(l));
                if (!seen.has(id)) seen.set(id, { id, url: r.url, title: rest[0] || '', priceText, image: r.image, location: rest[1] || '' });
            }
        } catch (e) { console.error('facebook', city, e.message); }
        await p.close(); await sleep(2000);
    }
    return [...seen.values()];
}

// One sapi call per US area. An item is an array: [id - minPostingId, ..., categoryId, price, "locationIndex:...", ..., [4, images...],
// [6, slug], [10, priceText], title]; decode.locations[locationIndex] is [areaId, hostname, subarea].
export function craigslistItems(d, categories, fallbackPlace) {
    return (d.items || []).map(it => {
        const id = d.decode.minPostingId + it[0], tag = n => it.find(x => Array.isArray(x) && x[0] === n) || [];
        const index = Number(String(it[4]).split(':')[0]), loc = d.decode.locations[index] || [], img = tag(4)[1];
        const host = loc[1] || 'www', sub = loc[2] ? loc[2] + '/' : '', cat = categories[it[2]] || 'sss';
        return { id: 'craigslist:' + id, url: `https://${host}.craigslist.org/${sub}${cat}/d/${tag(6)[1] || 'item'}/${id}.html`, title: it[it.length - 1],
            priceText: tag(10)[1] || '', image: img ? 'https://images.craigslist.org/' + String(img).replace(/^\d+:/, '') + '_300x300.jpg' : null,
            location: d.decode.locationDescriptions[index] || fallbackPlace };
    });
}

async function craigslist() {
    const areas = (await (await fetch('https://reference.craigslist.org/Areas')).json()).filter(a => a.Country === 'US');
    const categories = {}; for (const c of await (await fetch('https://reference.craigslist.org/Categories')).json()) categories[c.CategoryID] = c.Abbreviation;
    const out = new Map();
    for (const a of areas) {
        try {
            const r = await fetch(`https://sapi.craigslist.org/web/v8/postings/search/full?batch=${a.AreaID}-0-360-0-0&cc=US&lang=en&query=jibo&searchPath=sss`);
            for (const l of craigslistItems((await r.json()).data, categories, a.Description)) out.set(l.id, l);
        } catch (e) { console.error('craigslist', a.Hostname, e.message); }
        await sleep(800);
    }
    return [...out.values()];
}

// Poshmark serves its results in the page (window.__INITIAL_STATE__.$_search.gridData.data) to a plain request.
export function poshmarkItems(html) {
    const at = html.indexOf('window.__INITIAL_STATE__');
    if (at < 0) throw new Error('no search data');
    const start = html.indexOf('{', at);
    let depth = 0, end = start, inString = false;  // the object is followed by more script, so find its closing brace
    for (; end < html.length; end++) {
        const c = html[end];
        if (inString) { if (c === '\\') end++; else if (c === '"') inString = false; }
        else if (c === '"') inString = true;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) break;
    }
    const state = JSON.parse(html.slice(start, end + 1));
    return ((state.$_search && state.$_search.gridData && state.$_search.gridData.data) || [])
        .filter(i => i.inventory && i.inventory.status === 'available')
        .map(i => ({ id: 'poshmark:' + i.id, title: i.title, priceText: '$' + Number(i.price_amount.val).toFixed(2), image: i.picture_url, location: '',
            url: 'https://poshmark.com/listing/' + i.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + i.id }));
}

async function poshmark() {
    const r = await fetch('https://poshmark.com/search?query=jibo&type=listings&availability=available',
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return poshmarkItems(await r.text());
}

// Keeps firstSeen across runs; a marketplace that fails this run keeps its previous listings instead of vanishing.
export function merge(previous, results, now) {
    const old = new Map((previous.listings || []).map(l => [l.id, l])), listings = [], sources = {};
    for (const [source, r] of Object.entries(results)) {
        if (r.error) {
            sources[source] = { ...(previous.sources || {})[source], error: r.error };
            listings.push(...(previous.listings || []).filter(l => l.source === source));
            continue;
        }
        sources[source] = { updated: now, count: 0 };
        for (const l of r.items) {
            if (!l.title || !isJibo(l.title) || listings.some(x => x.id === l.id)) continue;
            listings.push({ ...l, source, price: price(l.priceText), firstSeen: (old.get(l.id) || {}).firstSeen || now });
            sources[source].count++;
        }
    }
    listings.sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || a.title.localeCompare(b.title));
    return { updated: now, sources, listings };
}

async function main() {
    const previous = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
    const b = await chromium.launch({ headless: false, channel: 'chromium', args: ['--disable-blink-features=AutomationControlled'] });
    const ctx = await b.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const results = {};
    for (const [name, run] of [['ebay', () => ebay(ctx)], ['mercari', () => mercari(ctx)], ['facebook', () => facebook(ctx)], ['craigslist', craigslist], ['poshmark', poshmark]]) {
        try { const items = await run(); results[name] = { items }; console.log(name, items.length, 'found'); }
        catch (e) { results[name] = { error: e.message.slice(0, 200) }; console.error(name, 'FAILED', e.message); }
    }
    await b.close();
    const data = merge(previous, results, new Date().toISOString());
    fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
    console.log('listings', data.listings.length, JSON.stringify(data.sources));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
