// node scraper/scrape.test.mjs — filter, price parsing and merge rules.
import assert from 'node:assert';
import { isJibo, price, merge, craigslistItems, poshmarkItems, hotness } from './scrape.mjs';

// Real titles from the first scrape.
for (const t of ['Jibo Social Robot', 'jibo robot can be powered on', 'New Factory Sealed Original Jibo Social Robot Box Unopened AI Collectible', 'Brand new jibo',
    'Jibo 2017 social robot', 'Jibo robot inteligente', 'New jibo robot', 'Real Jibo Power Blocks All Have Been Tested And Work As They Should',
    'A Here Is Black Jibo Robot Sold (AS-IS)', 'Jibo Robot " I will Be Your Friend "- The World\'s First Social Robot', 'JIBO charger base']) assert(isJibo(t), t);
for (const t of ['2001 Tekno Dinkie Robot Jibo Kie Mom Bot Voice Activated', '1980s Pro Photo Lab Japan Travels, Aizu Jibo Kannon statue', 'UAU Jiu Sua Jibo jumpup unit polaroid pob photocard',
    'Jibo Jibo ROBOT Windup Toy Be Your Friend', 'Jibonite rock', 'Roomba robot', 'Cartoni Jibo', 'New Cartoni Flat Base Adapter for JIBO Jib Arm (Black), MFR #AJ107',
    'Funko Pop Jibo Jones New #1255 Frunko Pop', 'K9F1208U0B-JIBO K9F1208U0B-JIB0 BGA Flash', 'IC chip K9F1G08R0B-JIBO BGA integrated circuit, new',
    'JIBO BAJE - ZARMA & SONGHAY EPICS NEW CD', 'Buddhism Metal JIBO KAN-NON (Mother Goddess)', "A Shi'i - Sunni Dialogue (al-Muraja'at): Illustrated Edition by Yasin T. Al-Jibo",
    'Leed’s Power tech Travel Outlet 3 Plug jibo Advertising/ Personalized', 'Enping Jibo Electronic USB Plug & Play Microphone RGB Lighting Stand Black',
    '$198 NWT DIESEL Sz12Y BOYS JIBO CAMO AND MOHAWK LIGHTWEIGHT JACKET IN MULTI', 'Light Kou Club Rai Chi Jibo Acrylic Stand Black']) assert(!isJibo(t), t);
assert.strictEqual(price('$1,250.00'), 1250); assert.strictEqual(price('$282.42 to $300'), 282.42); assert.strictEqual(price('Free'), null);

const prev = { listings: [
    { id: 'ebay:1', source: 'ebay', title: 'Jibo robot', firstSeen: '2026-11-01T00:00:00.000Z' },
    { id: 'ebay:2', source: 'ebay', title: 'Jibo sold', firstSeen: '2026-11-01T00:00:00.000Z' },
    { id: 'facebook:9', source: 'facebook', title: 'Jibo FB', firstSeen: '2026-11-02T00:00:00.000Z' }] };
const now = '2026-11-08T00:00:00.000Z';
const out = merge(prev, {
    ebay: { items: [{ id: 'ebay:1', title: 'Jibo robot', priceText: '$300' }, { id: 'ebay:3', title: 'Jibo robot new', priceText: '$99' }, { id: 'ebay:4', title: 'Tekno Jibo Kie', priceText: '$5' }] },
    facebook: { error: 'timeout' }
}, now);
assert.deepStrictEqual(out.listings.map(l => l.id), ['ebay:3', 'facebook:9', 'ebay:1'], 'new first; sold ebay:2 gone; failed facebook kept; toy filtered');
assert.strictEqual(out.listings.find(l => l.id === 'ebay:1').firstSeen, '2026-11-01T00:00:00.000Z', 'firstSeen kept');
assert.strictEqual(out.listings.find(l => l.id === 'ebay:3').price, 99);
assert.strictEqual(out.sources.facebook.error, 'timeout'); assert.strictEqual(out.sources.ebay.count, 2);
// Shape of a real sapi response (boston, "robot").
const cl = craigslistItems({ decode: { minPostingId: 7941080805, locationDescriptions: [0, 'Mansfield/Foxboro'], locations: [0, [4, 'boston', 'sob']] },
    items: [[54176544, 2441821, 97, 50, '1:1~42.0212~-71.2178', '0t20CI', [13, 'x'], [4, '3:01313_2aXTP4cg0Nz_0t20CI'], [6, 'mansfield-roomba'], [10, '$50'], 'Roomba robot']] }, { 97: 'hsh' }, 'boston');
assert.deepStrictEqual(cl[0], { id: 'craigslist:7995257349', url: 'https://boston.craigslist.org/sob/hsh/d/mansfield-roomba/7995257349.html', title: 'Roomba robot',
    priceText: '$50', image: 'https://images.craigslist.org/01313_2aXTP4cg0Nz_0t20CI_300x300.jpg', location: 'Mansfield/Foxboro' });
// Shape of a real Poshmark search page; sold items are dropped.
const page = '<script>window.__INITIAL_STATE__=' + JSON.stringify({ $_search: { gridData: { data: [
    { id: '5b57a3a1aaa5b8581e93133c', title: 'Jibo robot', inventory: { status: 'available' }, price_amount: { val: '500.0' }, picture_url: 'https://di2ponv0v5otw.cloudfront.net/m_1.jpg' },
    { id: '5bc2eb127386bc470b708d6e', title: 'Jibo Robot', inventory: { status: 'sold_out' }, price_amount: { val: '400.0' }, picture_url: 'x', description: 'has a } and \\" in it' }] } } }) + ';window.__OTHER__={"a":1};</script>';
assert.deepStrictEqual(poshmarkItems(page), [{ id: 'poshmark:5b57a3a1aaa5b8581e93133c', title: 'Jibo robot', priceText: '$500.00', location: '',
    image: 'https://di2ponv0v5otw.cloudfront.net/m_1.jpg', url: 'https://poshmark.com/listing/Jibo-robot-5b57a3a1aaa5b8581e93133c' }]);
assert.throws(() => poshmarkItems('<html>blocked</html>'), /no search data/);
// Hotness: price curve, sealed, trusted seller, clamping, hot above 5.
const h = (p, extra) => hotness({ source: 'ebay', title: 'Jibo Social Robot', price: p, ...extra });
assert.deepStrictEqual([600, 100, 50, 0, 1250, 2000, 350, 925, null].map(p => h(p)), [0, 6, 6, 6, -6, -6, 3, -3, 0]);
assert.strictEqual(h(400, { title: 'New Factory Sealed Original Jibo Social Robot Box Unopened' }), 4, '2.4 + 2 sealed');
assert.strictEqual(h(400, { title: 'Jibo robot, unsealed' }), 2, 'unsealed is not sealed');
for (const title of ['Factory Jibo robot', 'Jibo robot unopened', 'New jibo robot', 'Brand new jibo']) assert.strictEqual(h(400, { title }), 4, title);
for (const title of ['Jibo robot like new', 'Jibo robot, like-new condition', 'Jibo robot, not sealed']) assert.strictEqual(h(400, { title }), 2, title);
assert.strictEqual(h(400, { seller: 'wesyojoe', title: 'New Factory Sealed Original Jibo Social Robot Box Unopened' }), 6, 'trusted + sealed');
assert.strictEqual(h(100, { seller: 'MOR_749116', title: 'Sealed Jibo robot' }), 10, 'max 10');
assert.strictEqual(hotness({ source: 'facebook', title: 'Jibo', price: 600, seller: 'wesyojoe' }), 0, 'trusted only on its marketplace');
assert.strictEqual(out.listings.find(l => l.id === 'ebay:3').hotness, 8, 'merge stores hotness ($99 = 6, "new" = +2)');
console.log('PASS scrape');
