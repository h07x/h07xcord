const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const esbuild = require('esbuild');
const context = { module: { exports: {} }, setTimeout, Promise, Symbol, Math, Number, Set, Array, Error };
vm.runInNewContext(esbuild.transformSync(fs.readFileSync('src/utils/purgeDm.ts', 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2020' }).code, context);
const { purgeOwnMessages, MIN_DELAY_MS, PURGE_DEFAULTS } = context.module.exports;

const ME = '1', THEM = '2', CH = '900';
// 230 messages, newest first; every third is mine, two of mine are system messages.
const history = Array.from({ length: 230 }, (_, i) => ({ id: String(10000 - i), author: { id: i % 3 === 0 ? ME : THEM }, type: i === 30 ? 7 : i === 60 ? 3 : 0 }));
const mine = history.filter((m, i) => i % 3 === 0 && m.type === 0).map(m => m.id);
function makeRest({ del } = {}) {
    const gets = [], deletes = [];
    return {
        gets, deletes,
        get: async ({ url, query }) => {
            assert.equal(url, `/channels/${CH}/messages`);
            gets.push(query.before ?? null);
            const start = query.before ? history.findIndex(m => m.id === query.before) + 1 : 0;
            return { body: history.slice(start, start + query.limit) };
        },
        del: async request => { const id = request.url.split('/').pop(); if (del) await del(id); deletes.push(id); },
    };
}
const run = (rest, extra = {}) => {
    const sleeps = [], progress = [];
    return purgeOwnMessages({ rest, channelId: CH, authorId: ME, random: () => 1, sleep: async ms => { sleeps.push(ms); }, onProgress: p => progress.push({ ...p }), ...extra })
        .then(result => ({ result, sleeps, progress }));
};

(async () => {
    assert.deepEqual({ ...PURGE_DEFAULTS }, { delayMs: 1200, jitterMs: 500, burstEvery: 25, burstPauseMs: 30000, maxPerRun: 500 });

    // Paging, filtering, one 429 (wait + double delay) and one 403 skip; no burst or limit.
    let limited = false;
    const rest = makeRest({ del: async id => {
        if (id === '9997' && !limited) { limited = true; throw { status: 429, body: { retry_after: 2 } }; }
        if (id === '9994') throw { status: 403 };
    } });
    const a = await run(rest, { burstEvery: 0, maxPerRun: 0 });
    assert.deepEqual(rest.gets, [null, '9901', '9801'], 'pages with before = oldest id of the previous page, stops on a short page');
    assert.equal(a.result.found, mine.length, 'only my normal messages, system messages skipped');
    assert.deepEqual(rest.deletes, mine.filter(id => id !== '9994'), 'newest to oldest, never the other person, 429 retried, 403 skipped');
    assert.equal(a.result.skipped, 1); assert.equal(a.result.stop, 'done');
    const wait = a.sleeps.indexOf(2000);
    assert.ok(wait >= 0, 'waits retry_after');
    assert.ok(a.sleeps.slice(0, wait).every(ms => ms === 1200 + 500), 'default 1.2s delay plus up to 0.5s jitter before the 429');
    assert.ok(a.sleeps.slice(wait + 1).every(ms => ms === 2400 + 500), 'delay doubled for the rest of the run');
    assert.equal(a.result.delay, 2400);
    assert.ok(a.progress.some(p => p.waiting?.reason === 'rateLimit'), 'progress shows the rate-limit wait');

    // Minimum delay can't be undercut.
    const b = await run(makeRest(), { delayMs: 100, jitterMs: 0, burstEvery: 0, maxPerRun: 3 });
    assert.ok(b.sleeps.every(ms => ms === MIN_DELAY_MS), 'delay is clamped to 0.8s');

    // Burst pause every N deletes, with the countdown in progress.
    const c = await run(makeRest(), { jitterMs: 0, burstEvery: 5, burstPauseMs: 30000, maxPerRun: 12 });
    assert.deepEqual(c.sleeps.map(ms => ms === 30000 ? 'P' : 'd').join(''), 'ddddPddddPd', 'pause after every 5th delete, none after the last');
    assert.equal(c.progress.find(p => p.deleted === 2 && !p.waiting).nextPauseIn, 3, 'next pause countdown');
    assert.ok(c.progress.some(p => p.waiting?.reason === 'burst' && p.waiting.ms === 30000));

    // Max per run stops with "limit".
    assert.equal(c.result.deleted, 12); assert.equal(c.result.stop, 'limit');

    // Three 429s in a row end the run.
    const d = await run(makeRest({ del: async id => { if (id !== '10000') throw { status: 429, body: { retry_after: 1 } }; } }), { burstEvery: 0 });
    assert.equal(d.result.stop, 'rateLimited'); assert.equal(d.result.deleted, 1);
    assert.deepEqual(d.sleeps.filter(ms => ms === 1000).length, 2, 'waits on the first two, stops on the third');

    // A success in between resets the streak.
    let n = 0;
    const e = await run(makeRest({ del: async () => { if (++n % 3 !== 0) throw { status: 429, body: { retry_after: 1 } }; } }), { burstEvery: 0, maxPerRun: 4 });
    assert.equal(e.result.stop, 'limit', 'two 429s then a success keeps going');

    // Cancel.
    const signal = { cancelled: false };
    let count = 0;
    const f = await run(makeRest({ del: async () => { if (++count === 3) signal.cancelled = true; } }), { signal, burstEvery: 0 });
    assert.equal(f.result.stop, 'cancelled'); assert.equal(f.result.deleted, 3, 'stops right after cancel');
    console.log('PASS purge DM: paging, own-message filter, min delay, jitter, burst pauses, max per run, 429 backoff and streak stop, cancel');
})().catch(error => { console.error(error); process.exitCode = 1; });
