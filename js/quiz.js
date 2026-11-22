/**
 * 問題づくりのロジック（DOMに触らない）。
 */

// 正解した回数で巻物が育つ。
export const LEVELS = [
    { min: 0, id: 'none', label: 'まだ' },
    { min: 1, id: 'bronze', label: 'どうの まきもの' },
    { min: 3, id: 'silver', label: 'ぎんの まきもの' },
    { min: 5, id: 'gold', label: 'きんの まきもの' },
];

export function levelOf(count) {
    let level = 0;
    LEVELS.forEach((l, i) => {
        if (count >= l.min) level = i;
    });
    return level;
}

function katakanaToHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, c =>
        String.fromCharCode(c.charCodeAt(0) - 0x60)
    );
}

/**
 * その漢字の読みとして正しいもの全部。ひっかけの選択肢から外すのに使う。
 * 「あ(がる)」は「あ」と「あがる」の両方を入れる。
 */
export function readingSet(kanji) {
    const set = new Set();
    for (const r of kanji.kun) {
        set.add(r.replace(/\(.*\)/, ''));
        set.add(r.replace(/[()]/g, ''));
    }
    for (const r of kanji.on) set.add(katakanaToHiragana(r));
    for (const ex of kanji.examples) set.add(ex.yomi);
    return set;
}

export function shuffle(list, rng = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * 1問つくる。ことばの中の漢字の読みを、ほかの漢字の読みに入れかえて
 * ひっかけの選択肢にする（送りがなや前後のひらがなは同じなので、
 * 読みの部分でしか見分けられない）。
 */
export function buildQuestion(kanji, pool, rng = Math.random, choiceCount = 3) {
    const ex = kanji.examples[Math.floor(rng() * kanji.examples.length)];
    const banned = readingSet(kanji);
    const candidates = [
        ...new Set(
            pool
                .filter(x => x.k !== kanji.k)
                .flatMap(x => x.examples.map(e => e.yomi))
                .filter(y => !banned.has(y))
        ),
    ];
    // 文字数が同じ読みを優先すると、長さで答えがばれにくい
    const sameLength = shuffle(
        candidates.filter(y => y.length === ex.yomi.length),
        rng
    );
    const others = shuffle(
        candidates.filter(y => y.length !== ex.yomi.length),
        rng
    );
    const wrong = [...sameLength, ...others].slice(0, choiceCount - 1);
    const toText = y => ex.pre + y + ex.post;
    return {
        kanji,
        example: ex,
        answer: toText(ex.yomi),
        choices: shuffle([ex.yomi, ...wrong], rng).map(toText),
    };
}

/**
 * 修行で出す漢字を n 個選ぶ。まだ育っていない巻物ほど出やすい。
 */
export function pickKanji(list, counts, n, rng = Math.random) {
    const rest = [...list];
    const picked = [];
    while (picked.length < n && rest.length > 0) {
        const weights = rest.map(x => 1 / (1 + (counts[x.k] || 0)) ** 2);
        const total = weights.reduce((a, b) => a + b, 0);
        let r = rng() * total;
        let i = 0;
        while (i < rest.length - 1 && r >= weights[i]) {
            r -= weights[i];
            i++;
        }
        picked.push(rest.splice(i, 1)[0]);
    }
    return picked;
}

/**
 * 1回の修行の問題を選ぶ。まだ集めていない漢字を最大 newMax 個まぜて、
 * のこりは集めた漢字の復習（育っていないものほど出やすい）。
 * 毎回かならず少しずつ巻物帳が埋まっていくようにするため。
 */
export function pickSession(list, counts, n, newMax, rng = Math.random) {
    const unseen = list.filter(x => !(counts[x.k] > 0));
    const seen = list.filter(x => counts[x.k] > 0);
    const fresh = shuffle(unseen, rng).slice(0, Math.min(newMax, n));
    const review = pickKanji(seen, counts, n - fresh.length, rng);
    // 集めた漢字がまだ少ないうちは、足りない分も新しい漢字で埋める
    const rest = shuffle(
        unseen.filter(x => !fresh.includes(x)),
        rng
    ).slice(0, n - fresh.length - review.length);
    return shuffle([...fresh, ...review, ...rest], rng);
}

/**
 * 対決用。最近出た漢字は避けてランダムに1つ。
 */
export function pickNext(list, recent, rng = Math.random) {
    const fresh = list.filter(x => !recent.includes(x.k));
    const from = fresh.length > 0 ? fresh : list;
    return from[Math.floor(rng() * from.length)];
}
