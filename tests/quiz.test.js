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
const { buildQuestion, pickTasks, pickNext, levelOf, readingSet } = await import('../js/quiz.js');
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
for (const g of [1, 2, 3]) {
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

{
    const { buildWriteQuestion, buildMixedQuestion } = await import('../js/quiz.js');
    for (const g of [1, 2, 3]) {
        const pool = kanjiByGrade(g);
        for (const x of pool) {
            for (let n = 0; n < 5; n++) {
                const q = buildWriteQuestion(x, pool, rng);
                assert.strictEqual(new Set(q.choices).size, 3, `${x.k} のかき問題は重複なしの3択`);
                assert.ok(q.choices.includes(x.k), `${x.k} のかき問題に正解がある`);
                // ひっかけの漢字が、同じふりがなで読めてしまわない
                for (const c of q.choices.filter(c => c !== x.k)) {
                    assert.ok(!readingSet(getKanji(c)).has(q.example.yomi), `${q.example.word}(${q.example.yomi}) のひっかけ ${c} が同じ読み`);
                    assert.ok(!q.example.word.includes(c), `${q.example.word} のひっかけ ${c} がことばの中にある`);
                }
            }
        }
    }
    check('かき問題：全漢字で3択・正解あり・ひっかけが同じ読みにならない', true);
    check('日・火のように同じ読みの漢字はひっかけに出ない', (() => {
        const hi = getKanji('火');
        for (let i = 0; i < 300; i++) {
            const q = buildWriteQuestion(hi, kanjiByGrade(1), rng);
            if (q.example.yomi === 'ひ' && q.choices.includes('日')) return false;
        }
        return true;
    })());
    const types = new Set();
    for (let i = 0; i < 50; i++) types.add(buildMixedQuestion(getKanji('山'), kanjiByGrade(1), { rng }).type);
    check('まぜると読み・かき両方出る', types.has('read') && types.has('write'));
}

{
    const { matchLabel, pickMatchSet } = await import('../js/quiz.js');
    check('あわせの読みカード：訓はひらがな', matchLabel(getKanji('山')).text === 'やま');
    check('あわせの読みカード：訓がなければ音をカタカナで', matchLabel(getKanji('校')).text === 'コウ');
    for (const g of [1, 2, 3]) {
        for (let i = 0; i < 200; i++) {
            const set = pickMatchSet(kanjiByGrade(g), 6, rng);
            assert.strictEqual(set.length, 6, '6組そろう');
            for (const a of set) {
                for (const b of set) {
                    if (a !== b) assert.ok(!readingSet(a.kanji).has(b.label.yomi), `${a.kanji.k} が ${b.label.text} とも組めてしまう`);
                }
            }
        }
    }
    check('あわせ：6組そろい、どの読みカードも1つの漢字としか組めない', true);
}

const up = buildQuestion(getKanji('上'), kanjiByGrade(1), seeded(1));
check('送りがなは選択肢全部に付く', up.choices.every(c => c.endsWith(up.example.post)));

console.log('--- 出題の選び方 ---');
const g1 = kanjiByGrade(1);
const kinds = tasks => tasks.map(t => t.type);
const distinct = tasks => new Set(tasks.map(t => t.kanji.k)).size === tasks.length;
const all = v => Object.fromEntries(g1.map(x => [x.k, v]));

const first = pickTasks(g1, {}, {}, 10, 4, seeded(11));
check('はじめての修行は10問とも新しい漢字の読み', first.length === 10 && distinct(first) && kinds(first).every(t => t === 'read'));

const half = Object.fromEntries(g1.slice(0, 40).map(x => [x.k, 1]));
const s1 = pickTasks(g1, half, {}, 10, 4, seeded(12));
check('読んだことのない漢字は4問まで', s1.length === 10 && distinct(s1) && s1.filter(t => !half[t.kanji.k]).length === 4);
check('かき問題は読んだことのある漢字だけ', s1.filter(t => t.type === 'write').every(t => half[t.kanji.k] > 0));

const gold = pickTasks(g1, all(6), {}, 10, 4, seeded(13));
const writes = gold.filter(t => t.type === 'write').length;
check(`読みが全部金なら、ほとんど「かき」が出る（10問中${writes}問）`, gold.length === 10 && distinct(gold) && writes >= 8);

const done = pickTasks(g1, all(6), all(6), 10, 4, seeded(14));
check('読み・かきとも全部金でも10問出る', done.length === 10 && distinct(done));

const few = Object.fromEntries(g1.slice(0, 3).map(x => [x.k, 1]));
const f = pickTasks(g1, few, {}, 10, 4, seeded(15));
check('読んだ漢字が3つなら、3問復習＋7問新しい', f.length === 10 && distinct(f) && f.filter(t => !few[t.kanji.k]).length === 7);

// 1つだけ育っていない状態にすると、それが出やすい
const grown = all(20);
grown['山'] = 1;
let hits = 0;
const r2 = seeded(3);
for (let i = 0; i < 200; i++) if (pickTasks(g1, grown, all(20), 1, 4, r2)[0].kanji.k === '山') hits++;
// ランダムなら 160 択で 200 回中 1〜2 回。重みで半分くらいになる
check(`育っていない巻物が出やすい（200回中${hits}回）`, hits > 60);

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
addScroll('p1', '山', 'write');
check('読みとかきは別々に数える', getScrolls('p1', 'write')['山'] === 1 && getScrolls('p1', 'read')['山'] === 2);

{
    const { getBest, saveBestIfBetter } = await import('../js/storage.js');
    check('記録がないときは null', getBest('p1', 'match-g1') === null);
    check('はじめての記録は保存される', saveBestIfBetter('p1', 'match-g1', 12) && getBest('p1', 'match-g1') === 12);
    check('悪い記録では上書きしない', !saveBestIfBetter('p1', 'match-g1', 15) && getBest('p1', 'match-g1') === 12);
    check('よい記録で更新する', saveBestIfBetter('p1', 'match-g1', 9) && getBest('p1', 'match-g1') === 9);
}

store.set('kanjiNinpocho.players', '{壊れたJSON');
check('保存データが壊れていても初期値で動く', getPlayers().length === 2);

check('全漢字数は440（1年80・2年160・3年200）', KANJI.length === 440);
