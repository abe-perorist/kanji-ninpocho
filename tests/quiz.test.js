// 問題づくりと保存のロジックを確認する。localStorage だけスタブすればよい。

import assert from 'node:assert';

const store = new Map();
globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
};

const { KANJI, kanjiByGrade, getKanji } = await import('../js/kanji-data.js');
const { buildQuestion, pickKanji, pickNext, levelOf, readingSet } = await import('../js/quiz.js');
const { getPlayers, savePlayers, getScrolls, addScroll } = await import('../js/storage.js');

function check(label, cond) {
    assert.ok(cond, label);
    console.log(`  ✅ ${label}`);
}

// 再現できる乱数
function seeded(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    };
}

console.log('--- 問題 ---');
const rng = seeded(42);
for (const g of [1, 3]) {
    const pool = kanjiByGrade(g);
    for (const x of pool) {
        for (let n = 0; n < 5; n++) {
            const q = buildQuestion(x, pool, rng);
            assert.strictEqual(q.choices.length, 3, `${x.k} は3択`);
            assert.strictEqual(new Set(q.choices).size, 3, `${x.k} の選択肢が重複しない`);
            assert.ok(q.choices.includes(q.answer), `${x.k} の選択肢に正解がある`);
            // ひっかけがその漢字の別の正しい読みになっていない
            const banned = readingSet(x);
            const wrongYomi = q.choices
                .filter(c => c !== q.answer)
                .map(c => c.slice(q.example.pre.length, c.length - q.example.post.length));
            assert.ok(wrongYomi.every(y => !banned.has(y)), `${x.k} のひっかけが正しい読みでない: ${wrongYomi}`);
        }
    }
}
check('全漢字で3択・正解あり・ひっかけが別の正しい読みでない', true);

const up = buildQuestion(getKanji('上'), kanjiByGrade(1), seeded(1));
check('送りがなは選択肢全部に付く', up.choices.every(c => c.endsWith(up.example.post)));

console.log('--- 出題の選び方 ---');
const g1 = kanjiByGrade(1);
const picked = pickKanji(g1, {}, 10, seeded(7));
check('10問ぶん選べる', picked.length === 10);
check('同じ修行で同じ漢字が出ない', new Set(picked.map(x => x.k)).size === 10);
check('全部の数より多く頼んでも全部で止まる', pickKanji(g1.slice(0, 3), {}, 10).length === 3);

// 1つだけ育っていない状態にすると、そればかり出やすい
const counts = Object.fromEntries(g1.map(x => [x.k, 20]));
delete counts['山'];
let hits = 0;
const r2 = seeded(3);
for (let i = 0; i < 200; i++) if (pickKanji(g1, counts, 1, r2)[0].k === '山') hits++;
check(`育っていない巻物が出やすい（200回中${hits}回）`, hits > 50);

{
    const { pickSession } = await import('../js/quiz.js');
    const isNew = c => x => !(c[x.k] > 0);
    const first = pickSession(g1, {}, 10, 4, seeded(11));
    check('はじめての修行は10問とも新しい漢字', first.length === 10 && new Set(first.map(x => x.k)).size === 10);

    const half = Object.fromEntries(g1.slice(0, 40).map(x => [x.k, 1]));
    const s = pickSession(g1, half, 10, 4, seeded(12));
    check('集めた漢字が多いと、新しい漢字は4問まで', s.length === 10 && s.filter(isNew(half)).length === 4);

    const all = Object.fromEntries(g1.map(x => [x.k, 2]));
    const done = pickSession(g1, all, 10, 4, seeded(13));
    check('全部集めたあとも10問出る', done.length === 10 && new Set(done.map(x => x.k)).size === 10);

    const few = Object.fromEntries(g1.slice(0, 3).map(x => [x.k, 1]));
    const f = pickSession(g1, few, 10, 4, seeded(14));
    check('集めた漢字が3つなら、3問復習＋7問新しい', f.filter(isNew(few)).length === 7 && new Set(f.map(x => x.k)).size === 10);
}

const next = pickNext(g1, g1.slice(0, 79).map(x => x.k), seeded(5));
check('対決では最近出た漢字を避ける', next.k === g1[79].k);

console.log('--- 巻物のレベル ---');
check('0回=なし 1回=銅 3回=銀 5回=金', [0, 1, 2, 3, 4, 5, 9].map(levelOf).join() === '0,1,1,2,2,3,3');

console.log('--- 保存 ---');
check('はじめは2人ぶんのプレイヤー', getPlayers().length === 2);
const players = getPlayers();
players[0].name = 'たろう';
savePlayers(players);
check('名前が保存される', getPlayers()[0].name === 'たろう');
check('キーに接頭辞が付く（計算忍者とぶつからない）', [...store.keys()].every(k => k.startsWith('kanjiNinpocho.')));

addScroll('p1', '山');
const r = addScroll('p1', '山');
check('正解の回数が数えられる', r.before === 1 && r.after === 2 && getScrolls('p1')['山'] === 2);
check('プレイヤーごとに別々', !getScrolls('p2')['山']);

store.set('kanjiNinpocho.players', '{壊れたJSON');
check('保存データが壊れていても初期値で動く', getPlayers().length === 2);

check('全漢字数は280', KANJI.length === 280);
