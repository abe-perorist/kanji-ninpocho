import { GRADES, kanjiByGrade } from './kanji-data.js';
import { LEVELS, buildQuestion, levelOf, pickKanji, pickNext } from './quiz.js';
import { addScroll, getPlayers, getScrolls, savePlayers } from './storage.js';

const QUIZ_LENGTH = 10;
const BATTLE_SECONDS = 60;
const PENALTY_MS = 1000;

const app = document.getElementById('app');
let cleanup = null; // 画面を離れるときに止めるタイマーなど

// ===== 小道具 =====

function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'class') node.className = value;
        else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
        if (child == null || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

function show(...children) {
    if (cleanup) cleanup();
    cleanup = null;
    app.replaceChildren(...children);
    window.scrollTo(0, 0);
}

const correctSound = new Audio('sounds/correct.mp3');
let audioCtx = null;

function playCorrect() {
    try {
        correctSound.currentTime = 0;
        correctSound.play().catch(() => {});
    } catch {
        // 音が出なくても遊べる
    }
}

function playWrong() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = 140;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.35);
    } catch {
        // 音が出なくても遊べる
    }
}

// ことばの中の、問われている漢字だけ色を変える
function wordView(q) {
    const { word } = q.example;
    const i = word.indexOf(q.kanji.k);
    return el(
        'div',
        { class: 'word' },
        word.slice(0, i),
        el('span', { class: 'target' }, q.kanji.k),
        word.slice(i + 1)
    );
}

function collectedCount(player) {
    const scrolls = getScrolls(player.id);
    const list = kanjiByGrade(player.grade);
    return {
        got: list.filter(x => scrolls[x.k] > 0).length,
        gold: list.filter(x => levelOf(scrolls[x.k] || 0) === 3).length,
        total: list.length,
    };
}

function scrollBadge(k, level) {
    return el('span', { class: `scroll lv${level}` }, k);
}

// ===== ホーム =====

function showHome() {
    const players = getPlayers();

    const cards = players.map((player, index) => {
        const c = collectedCount(player);
        const rename = () => {
            const name = window.prompt('なまえを いれてね', player.name);
            if (name && name.trim()) {
                players[index].name = name.trim().slice(0, 10);
                savePlayers(players);
                showHome();
            }
        };
        const changeGrade = () => {
            const i = GRADES.indexOf(player.grade);
            players[index].grade = GRADES[(i + 1) % GRADES.length];
            savePlayers(players);
            showHome();
        };
        return el(
            'div',
            { class: 'player-card' },
            el('button', { class: 'name', onclick: rename }, player.name, el('small', {}, ' ✎')),
            el('button', { class: 'grade', onclick: changeGrade }, `${player.grade}ねんせい`),
            el('div', { class: 'progress' }, `まきもの ${c.got} / ${c.total}`, el('br'), `きん ${c.gold}`),
            el('button', { class: 'btn primary', onclick: () => startQuiz(player) }, 'しゅぎょう'),
            el('button', { class: 'btn', onclick: () => showCollection(player) }, 'まきものちょう')
        );
    });

    show(
        el(
            'main',
            { class: 'home' },
            el('h1', {}, 'かんじ', el('span', {}, '忍法帖')),
            el('p', { class: 'lead' }, 'かんじの よみを あてて、まきものを あつめよう'),
            el('div', { class: 'players' }, cards),
            el('button', { class: 'btn battle', onclick: () => startBattle(players) }, '⚔ きょうだい たいけつ')
        )
    );
}

// ===== 修行（10問） =====

function startQuiz(player) {
    const pool = kanjiByGrade(player.grade);
    const targets = pickKanji(pool, getScrolls(player.id), QUIZ_LENGTH);
    const state = { index: 0, correct: 0, grown: [], missed: [] };
    let timer = null;

    const next = () => {
        state.index++;
        if (state.index < targets.length) render();
        else showResult(player, state, targets.length);
    };

    const render = () => {
        const q = buildQuestion(targets[state.index], pool);
        const feedback = el('div', { class: 'feedback' });

        const answer = (button, choice) => {
            if (choices.dataset.done) return;
            choices.dataset.done = '1';
            if (choice === q.answer) {
                button.classList.add('ok');
                playCorrect();
                state.correct++;
                const { before, after } = addScroll(player.id, q.kanji.k);
                const grew = levelOf(after) > levelOf(before);
                if (grew) state.grown.push({ k: q.kanji.k, level: levelOf(after) });
                feedback.replaceChildren(
                    el('span', { class: 'good' }, 'せいかい！'),
                    grew ? el('span', { class: 'grow' }, `「${q.kanji.k}」が ${LEVELS[levelOf(after)].label}に！`) : null
                );
                timer = setTimeout(next, grew ? 1600 : 900);
            } else {
                button.classList.add('ng');
                [...choices.children].find(b => b.textContent === q.answer).classList.add('ok');
                playWrong();
                state.missed.push(q);
                feedback.replaceChildren(el('span', { class: 'bad' }, `こたえは「${q.answer}」`));
                timer = setTimeout(next, 2200);
            }
        };

        const choices = el(
            'div',
            { class: 'choices' },
            q.choices.map(c => {
                const b = el('button', { class: 'choice' }, c);
                b.addEventListener('click', () => answer(b, c));
                return b;
            })
        );

        show(
            el(
                'main',
                { class: 'quiz' },
                el(
                    'header',
                    {},
                    el('button', { class: 'back', onclick: showHome }, '← やめる'),
                    el('span', {}, `${player.name}　${state.index + 1} / ${targets.length}`)
                ),
                el('p', { class: 'ask' }, 'あかい かんじの よみかたは？'),
                wordView(q),
                choices,
                feedback
            )
        );
        cleanup = () => clearTimeout(timer);
    };

    render();
}

function showResult(player, state, total) {
    const message =
        state.correct === total ? 'かんぺき！ じょうにん だ！' : state.correct >= total * 0.7 ? 'すごい！ その ちょうし！' : 'しゅぎょうを つづけよう！';

    show(
        el(
            'main',
            { class: 'result' },
            el('h2', {}, `${state.correct} / ${total} もん せいかい`),
            el('p', { class: 'lead' }, message),
            state.grown.length > 0 &&
                el('section', {}, el('h3', {}, 'そだった まきもの'), el('div', { class: 'scroll-row' }, state.grown.map(g => scrollBadge(g.k, g.level)))),
            state.missed.length > 0 &&
                el(
                    'section',
                    {},
                    el('h3', {}, 'もういちど おぼえよう'),
                    el(
                        'ul',
                        { class: 'missed' },
                        state.missed.map(q => el('li', {}, el('span', { class: 'w' }, q.example.word), ` … ${q.answer}`))
                    )
                ),
            el(
                'div',
                { class: 'actions' },
                el('button', { class: 'btn primary', onclick: () => startQuiz(player) }, 'もういちど'),
                el('button', { class: 'btn', onclick: () => showCollection(player) }, 'まきものちょう'),
                el('button', { class: 'btn', onclick: showHome }, 'もどる')
            )
        )
    );
}

// ===== 巻物帳 =====

function showCollection(player) {
    const scrolls = getScrolls(player.id);
    const list = kanjiByGrade(player.grade);
    const c = collectedCount(player);

    const detail = el('div', { class: 'detail hidden' });
    const openDetail = x => {
        const count = scrolls[x.k] || 0;
        detail.replaceChildren(
            el(
                'div',
                { class: 'detail-card' },
                el('div', { class: `big lv${levelOf(count)}` }, x.k),
                el('p', {}, `くんよみ：${x.kun.join('、') || 'なし'}`),
                el('p', {}, `おんよみ：${x.on.join('、') || 'なし'}`),
                el('ul', {}, x.examples.map(ex => el('li', {}, `${ex.word}（${ex.pre}${ex.yomi}${ex.post}）`))),
                el('p', { class: 'count' }, count > 0 ? `${count}かい せいかい・${LEVELS[levelOf(count)].label}` : 'まだ せいかい していない'),
                el('button', { class: 'btn', onclick: () => detail.classList.add('hidden') }, 'とじる')
            )
        );
        detail.classList.remove('hidden');
    };

    show(
        el(
            'main',
            { class: 'collection' },
            el(
                'header',
                {},
                el('button', { class: 'back', onclick: showHome }, '← もどる'),
                el('span', {}, `${player.name}の まきものちょう（${player.grade}ねん）`)
            ),
            el('p', { class: 'lead' }, `あつめた ${c.got} / ${c.total}　きん ${c.gold}`),
            el(
                'div',
                { class: 'legend' },
                LEVELS.slice(1).map((l, i) => el('span', {}, scrollBadge('字', i + 1), l.label, `（${l.min}かい）`))
            ),
            el(
                'div',
                { class: 'grid' },
                list.map(x => {
                    const b = scrollBadge(x.k, levelOf(scrolls[x.k] || 0));
                    b.addEventListener('click', () => openDetail(x));
                    return b;
                })
            ),
            detail
        )
    );
}

// ===== 兄弟対決 =====

function startBattle(players) {
    const sides = players.map(player => ({
        player,
        pool: kanjiByGrade(player.grade),
        score: 0,
        recent: [],
        lockedUntil: 0,
        root: el('section', { class: 'side' }),
    }));
    const clock = el('div', { class: 'clock' }, '3');
    let timeLeft = BATTLE_SECONDS;
    let running = false;
    const timers = [];

    const renderSide = side => {
        const kanji = pickNext(side.pool, side.recent);
        side.recent = [...side.recent, kanji.k].slice(-8);
        const q = buildQuestion(kanji, side.pool);
        const choices = el('div', { class: 'choices' });
        for (const c of q.choices) {
            const b = el('button', { class: 'choice' }, c);
            b.addEventListener('click', () => {
                if (!running || Date.now() < side.lockedUntil) return;
                if (c === q.answer) {
                    side.score++;
                    addScroll(side.player.id, kanji.k);
                    playCorrect();
                    renderSide(side);
                } else {
                    // まちがえたら少しだけお休み。連打でまぐれ当たりを防ぐ
                    playWrong();
                    side.lockedUntil = Date.now() + PENALTY_MS;
                    b.classList.add('ng');
                    side.root.classList.add('locked');
                    timers.push(setTimeout(() => side.root.classList.remove('locked'), PENALTY_MS));
                }
            });
            choices.append(b);
        }
        side.root.replaceChildren(
            el('div', { class: 'side-head' }, el('span', {}, `${side.player.name}（${side.player.grade}ねん）`), el('strong', {}, `${side.score}`)),
            wordView(q),
            choices
        );
    };

    const finish = () => {
        running = false;
        const [a, b] = sides;
        const text = a.score === b.score ? 'ひきわけ！' : `${(a.score > b.score ? a : b).player.name} の かち！`;
        const overlay = el(
            'div',
            { class: 'overlay' },
            el(
                'div',
                { class: 'detail-card' },
                el('h2', {}, text),
                el('p', { class: 'lead' }, `${a.player.name} ${a.score}もん ・ ${b.player.name} ${b.score}もん`),
                el(
                    'div',
                    { class: 'actions' },
                    el('button', { class: 'btn primary', onclick: () => startBattle(getPlayers()) }, 'もういっかい'),
                    el('button', { class: 'btn', onclick: showHome }, 'もどる')
                )
            )
        );
        app.querySelector('.battle-screen').append(overlay);
    };

    show(
        el(
            'main',
            { class: 'battle-screen' },
            sides[0].root,
            el('div', { class: 'middle' }, clock, el('button', { class: 'back', onclick: showHome }, 'やめる')),
            sides[1].root
        )
    );
    sides.forEach(renderSide);

    // 3, 2, 1 のあとスタート
    let count = 3;
    const countdown = setInterval(() => {
        count--;
        if (count > 0) {
            clock.textContent = String(count);
            return;
        }
        clearInterval(countdown);
        running = true;
        clock.textContent = String(timeLeft);
        const tick = setInterval(() => {
            timeLeft--;
            clock.textContent = String(timeLeft);
            if (timeLeft <= 0) {
                clearInterval(tick);
                finish();
            }
        }, 1000);
        timers.push(tick);
    }, 1000);
    timers.push(countdown);

    cleanup = () => timers.forEach(t => (clearInterval(t), clearTimeout(t)));
}

showHome();
