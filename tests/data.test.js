// 漢字データの正しさを確認する。子どもが覚えるものなので、ここは厳しめに。

import assert from 'node:assert';
import { KANJI, kanjiByGrade } from '../js/kanji-data.js';

// 学習指導要領の学年別漢字配当表（2020年度〜）
const LIST = {
    1: '一右雨円王音下火花貝学気九休玉金空月犬見五口校左三山子四糸字耳七車手十出女小上森人水正生青夕石赤千川先早草足村大男竹中虫町天田土二日入年白八百文木本名目立力林六',
    2: '引羽雲園遠何科夏家歌画回会海絵外角楽活間丸岩顔汽記帰弓牛魚京強教近兄形計元言原戸古午後語工公広交光考行高黄合谷国黒今才細作算止市矢姉思紙寺自時室社弱首秋週春書少場色食心新親図数西声星晴切雪船線前組走多太体台地池知茶昼長鳥朝直通弟店点電刀冬当東答頭同道読内南肉馬売買麦半番父風分聞米歩母方北毎妹万明鳴毛門夜野友用曜来里理話',
    3: '悪安暗医委意育員院飲運泳駅央横屋温化荷界開階寒感漢館岸起期客究急級宮球去橋業曲局銀区苦具君係軽血決研県庫湖向幸港号根祭皿仕死使始指歯詩次事持式実写者主守取酒受州拾終習集住重宿所暑助昭消商章勝乗植申身神真深進世整昔全相送想息速族他打対待代第題炭短談着注柱丁帳調追定庭笛鉄転都度投豆島湯登等動童農波配倍箱畑発反坂板皮悲美鼻筆氷表秒病品負部服福物平返勉放味命面問役薬由油有遊予羊洋葉陽様落流旅両緑礼列練路和',
};

function check(label, cond) {
    assert.ok(cond, label);
    console.log(`  ✅ ${label}`);
}

const isKanji = c => /\p{Script=Han}/u.test(c);
const isKana = c => /[ぁ-ゖー]/.test(c);

console.log('--- 配当表どおりか ---');
check('配当表は1年80字・2年160字・3年200字', [...LIST[1]].length === 80 && [...LIST[2]].length === 160 && [...LIST[3]].length === 200);
for (const g of [1, 3]) {
    const got = kanjiByGrade(g).map(x => x.k).sort().join('');
    const want = [...LIST[g]].sort().join('');
    const missing = [...LIST[g]].filter(k => !got.includes(k));
    const extra = kanjiByGrade(g).map(x => x.k).filter(k => !LIST[g].includes(k));
    assert.deepStrictEqual({ missing, extra }, { missing: [], extra: [] }, `${g}年の漢字が配当表と一致する`);
    check(`${g}年の漢字が配当表と一致（${got.length}字）`, got === want);
}
check('漢字に重複がない', new Set(KANJI.map(x => x.k)).size === KANJI.length);

console.log('--- 例のことば ---');
for (const x of KANJI) {
    assert.ok(x.examples.length >= 1, `${x.k} に例がある`);
    assert.ok(x.kun.length + x.on.length >= 1, `${x.k} に読みがある`);
    assert.ok(x.on.every(r => /^[ァ-ヶー]+$/.test(r)), `${x.k} の音読みはカタカナ`);
    assert.ok(x.kun.every(r => /^[ぁ-ゖ]+(\([ぁ-ゖ]+\))?$/.test(r)), `${x.k} の訓読みはひらがな`);
    for (const ex of x.examples) {
        const label = `${x.k}: ${ex.word}`;
        assert.ok(ex.word.includes(x.k), `${label} にその漢字が入っている`);
        assert.ok([...ex.yomi].every(isKana), `${label} の漢字のよみがひらがな`);
        assert.ok([...ex.pre, ...ex.post].every(c => isKana(c) || /[\u30a1-\u30f6ー]/.test(c)), `${label} のよみがかな`);
        // その学年までに習う漢字だけを使う
        const allowed = x.grade === 1 ? LIST[1] : LIST[1] + LIST[2] + LIST[3];
        const bad = [...ex.word].filter(c => isKanji(c) && !allowed.includes(c));
        assert.deepStrictEqual(bad, [], `${label} に習っていない漢字がない`);
        // 対象の漢字以外がかなだけのことばは、よみと形が一致するはず
        if ([...ex.word].filter(isKanji).join('') === x.k) {
            const i = ex.word.indexOf(x.k);
            const rebuilt = ex.word.slice(0, i) + ex.yomi + ex.word.slice(i + 1);
            const reading = ex.pre + ex.yomi + ex.post;
            // カタカナ（ビー玉など）はひらがなに直して比べる
            const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
            assert.strictEqual(toHira(rebuilt), toHira(reading), `${label} のよみが形と一致`);
        }
    }
}
check('全ての例が「習った漢字だけ」「よみの形が正しい」', true);
