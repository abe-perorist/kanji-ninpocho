import { GRADES, kanjiByGrade } from './kanji-data.js';
import {
    LEVELS,
    buildMixedQuestion,
    buildQuestion,
    buildWriteQuestion,
    levelOf,
    pickMatchSet,
    pickNext,
    pickTasks,
    shuffle,
} from './quiz.js';
import { addScroll, getBest, getPlayers, getScrolls, saveBestIfBetter, savePlayers } from './storage.js';

const QUIZ_LENGTH = 10;
const NEW_PER_QUIZ = 4; // 1回の修行でまぜる「まだ読んだことのない漢字」の数
const MATCH_PAIRS = 6;
const BATTLE_SECONDS = 60;
const PENALTY_MS = 1000;

// 巻物は「よみ」と「かき」の2しゅるい。かきは読みを集めた漢字から出る
const TRACKS = {
    read: { label: 'よみ' },
    write: { label: 'かき' },
};

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

function playChime() {
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        [784, 1175].forEach((freq, i) => {
            const t = audioCtx.currentTime + i * 0.12;
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.2, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t);
            osc.stop(t + 0.4);
        });
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

// 問題の種類ごとの見せ方。fill() は答えたあとに正解を見せる
function questionView(q) {
    if (q.type === 'read') {
        return { ask: 'あかい かんじの よみかたは？', view: wordView(q), fill: () => {} };
    }
    const { word } = q.example;
    const i = word.indexOf(q.kanji.k);
    const box = el('span', { class: 'box' }, '？');
    return {
        ask: '□に はいる かんじは？',
        view: el('div', { class: 'word' }, word.slice(0, i), el('ruby', {}, box, el('rt', {}, q.example.yomi)), word.slice(i + 1)),
        fill: () => {
            box.textContent = q.kanji.k;
            box.classList.add('filled');
        },
    };
}

function choiceButton(q, text) {
    return el('button', { class: q.type === 'write' ? 'choice kanji-choice' : 'choice' }, text);
}

function collectedCount(player, track = 'read') {
    const scrolls = getScrolls(player.id, track);
    const list = kanjiByGrade(player.grade);
    return {
        got: list.filter(x => scrolls[x.k] > 0).length,
        gold: list.filter(x => levelOf(scrolls[x.k] || 0) === 3).length,
        total: list.length,
    };
}

function scrollBadge(k, level, track = 'read') {
    return el('span', { class: `scroll lv${level} ${track}` }, k);
}

function trackTag(track) {
    return el('span', { class: `track-tag ${track}` }, TRACKS[track].label);
}

// ===== ホーム =====

function showHome() {
    const players = getPlayers();

    const cards = players.map((player, index) => {
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
            el(
                'div',
                { class: 'progress' },
                Object.keys(TRACKS).map(track => {
                    const c = collectedCount(player, track);
                    return el('div', {}, trackTag(track), ` ${c.got} / ${c.total}　きん ${c.gold}`);
                })
            ),
            el('button', { class: 'btn primary', onclick: () => startQuiz(player) }, 'しゅぎょう'),
            el(
                'div',
                { class: 'sub-buttons' },
                el('button', { class: 'btn', onclick: () => startMatch(player) }, 'かんじ あわせ'),
                el('button', { class: 'btn', onclick: () => showCollection(player) }, 'まきものちょう')
            )
        );
    });

    show(
        el(
            'main',
            { class: 'home' },
            el('h1', {}, 'かんじ', el('span', {}, '忍法帖')),
            el('p', { class: 'lead' }, 'かんじを よんで かいて、まきものを あつめよう'),
            el('div', { class: 'players' }, cards),
            el('button', { class: 'btn battle', onclick: () => startBattle(players) }, '⚔ きょうだい たいけつ')
        )
    );
}

// ===== 修行（10問） =====

function startQuiz(player) {
    const pool = kanjiByGrade(player.grade);
    const tasks = pickTasks(pool, getScrolls(player.id, 'read'), getScrolls(player.id, 'write'), QUIZ_LENGTH, NEW_PER_QUIZ);
    const state = {
        index: 0,
        results: [],
        combo: 0,
        bestCombo: 0,
        fresh: [], // はじめて集めた巻物 { k, track }
        grown: [], // 銀・金に育った巻物 { k, track }
        missed: [],
        tracks: [...new Set(tasks.map(t => t.type))],
        gotBefore: {
            read: collectedCount(player, 'read').got,
            write: collectedCount(player, 'write').got,
        },
    };
    let timers = [];
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));

    const next = () => {
        state.index++;
        if (state.index < tasks.length) render();
        else showResult(player, state);
    };

    const render = () => {
        const { kanji, type: track } = tasks[state.index];
        const isNew = !(getScrolls(player.id, track)[kanji.k] > 0);
        const q = track === 'write' ? buildWriteQuestion(kanji, pool) : buildQuestion(kanji, pool);
        const qv = questionView(q);
        const feedback = el('div', { class: 'feedback' });
        const card = el(
            'div',
            { class: 'card' },
            isNew && el('span', { class: 'new-tag' }, track === 'write' ? 'はじめての かき' : 'はじめての かんじ'),
            qv.view
        );
        const dots = el(
            'div',
            { class: 'dots' },
            tasks.map((_, i) => {
                const r = state.results[i];
                return el('span', { class: `dot${r === true ? ' ok' : r === false ? ' ng' : ''}${i === state.index ? ' now' : ''}` });
            })
        );
        const screen = el('main', { class: 'quiz' });

        const answer = (button, choice) => {
            if (choices.dataset.done) return;
            choices.dataset.done = '1';
            const dot = dots.children[state.index];
            qv.fill();

            if (choice !== q.answer) {
                button.classList.add('ng');
                [...choices.children].find(b => b.textContent === q.answer).classList.add('ok');
                dot.classList.add('ng');
                playWrong();
                state.results.push(false);
                state.combo = 0;
                state.missed.push(q);
                feedback.replaceChildren(el('span', { class: 'bad' }, q.type === 'write' ? `こたえは「${q.answer}」（${q.reading}）` : `こたえは「${q.answer}」`));
                later(next, 2200);
                return;
            }

            button.classList.add('ok');
            dot.classList.add('ok');
            state.results.push(true);
            state.combo++;
            state.bestCombo = Math.max(state.bestCombo, state.combo);
            card.append(el('span', { class: 'shuriken' }, '✦'));

            const { before, after } = addScroll(player.id, kanji.k, track);
            const level = levelOf(after);
            const name = TRACKS[track].label;
            let wait = 900;
            if (before === 0) {
                state.fresh.push({ k: kanji.k, track });
                playChime();
                screen.append(revealView(kanji.k, level, track, `あたらしい ${name}の まきもの ゲット！`));
                wait = 1900;
            } else if (level > levelOf(before)) {
                state.grown.push({ k: kanji.k, track });
                playChime();
                screen.append(revealView(kanji.k, level, track, `${name}の ${LEVELS[level].label}に そだった！`));
                wait = 1900;
            } else {
                playCorrect();
            }
            feedback.replaceChildren(
                el('span', { class: 'good' }, 'せいかい！'),
                state.combo >= 2 ? el('span', { class: `combo c${Math.min(state.combo, 5)}` }, `${state.combo} れんぞく！`) : ''
            );
            later(next, wait);
        };

        const choices = el(
            'div',
            { class: 'choices' },
            q.choices.map(c => {
                const b = choiceButton(q, c);
                b.addEventListener('click', () => answer(b, c));
                return b;
            })
        );

        screen.append(
            el(
                'header',
                {},
                el('button', { class: 'back', onclick: showHome }, '← やめる'),
                dots,
                el('span', {}, player.name)
            ),
            el('p', { class: 'ask' }, qv.ask),
            card,
            choices,
            feedback
        );
        show(screen);
        cleanup = () => {
            timers.forEach(clearTimeout);
            timers = [];
        };
    };

    render();
}

function revealView(k, level, track, text) {
    return el(
        'div',
        { class: 'reveal' },
        el('div', { class: 'reveal-inner' }, el('div', { class: `reveal-scroll lv${level} ${track}` }, k), el('p', {}, text))
    );
}

function showResult(player, state) {
    const total = state.results.length;
    const correct = state.results.filter(Boolean).length;
    const list = kanjiByGrade(player.grade);
    const timers = [];

    // 盤面：今回埋まったマスを、よみ→かきの順に1つずつ光らせる
    let step = 0;
    const boards = state.tracks.map(track => {
        const scrolls = getScrolls(player.id, track);
        const now = collectedCount(player, track);
        const changes = new Map();
        for (const [kind, items] of [['fresh', state.fresh], ['grown', state.grown]]) {
            for (const item of items.filter(x => x.track === track)) {
                changes.set(item.k, { kind, delay: 0.8 + step++ * 0.4 });
            }
        }
        const gotView = el('strong', {}, String(state.gotBefore[track]));
        const cells = list.map(x => {
            const cell = el('span', { class: `cell lv${levelOf(scrolls[x.k] || 0)} ${track}` }, x.k);
            const c = changes.get(x.k);
            if (c) {
                cell.classList.add(c.kind);
                cell.style.animationDelay = `${c.delay}s`;
                if (c.kind === 'fresh') {
                    timers.push(setTimeout(() => (gotView.textContent = String(Number(gotView.textContent) + 1)), c.delay * 1000));
                }
            }
            return cell;
        });
        const rest = now.total - now.got;
        return el(
            'section',
            { class: 'board-section' },
            el(
                'p',
                { class: 'tally' },
                trackTag(track),
                ' の まきもの ',
                gotView,
                ` / ${now.total}`,
                el('br'),
                rest > 0 ? `あと ${rest}こ で ぜんぶ あつまる！` : 'ぜんぶ あつめた！ つぎは ぜんぶ きんを めざそう'
            ),
            el('div', { class: 'board' }, cells)
        );
    });

    const headline =
        state.fresh.length > 0
            ? `あたらしい まきもの ＋${state.fresh.length}`
            : correct === total
              ? 'かんぺき！'
              : 'しゅぎょう かんりょう';
    const sub = [
        `${correct} / ${total} もん せいかい`,
        state.bestCombo >= 3 ? `さいだい ${state.bestCombo} れんぞく` : null,
    ]
        .filter(Boolean)
        .join('・');

    show(
        el(
            'main',
            { class: 'result' },
            el('h2', {}, headline),
            el('p', { class: 'lead' }, sub),
            boards,
            el(
                'div',
                { class: 'actions' },
                el('button', { class: 'btn primary big', onclick: () => startQuiz(player) }, 'つづけて しゅぎょう'),
                el('button', { class: 'btn', onclick: () => showCollection(player) }, 'まきものちょう'),
                el('button', { class: 'btn', onclick: showHome }, 'もどる')
            ),
            state.missed.length > 0 &&
                el(
                    'section',
                    {},
                    el('h3', {}, 'もういちど おぼえよう'),
                    el(
                        'ul',
                        { class: 'missed' },
                        state.missed.map(q => el('li', {}, el('span', { class: 'w' }, q.example.word), ` … ${q.reading}`))
                    )
                )
        )
    );
    cleanup = () => timers.forEach(clearTimeout);
}

// ===== 巻物帳 =====

function showCollection(player, track = 'read') {
    const scrolls = getScrolls(player.id, track);
    const list = kanjiByGrade(player.grade);
    const c = collectedCount(player, track);

    const detail = el('div', { class: 'detail hidden' });
    const countText = t => {
        const n = getScrolls(player.id, t)[detail.dataset.k] || 0;
        return n > 0 ? `${TRACKS[t].label}：${n}かい せいかい・${LEVELS[levelOf(n)].label}` : `${TRACKS[t].label}：まだ`;
    };
    const openDetail = x => {
        const count = scrolls[x.k] || 0;
        detail.dataset.k = x.k;
        detail.replaceChildren(
            el(
                'div',
                { class: 'detail-card' },
                el('div', { class: `big lv${levelOf(count)}` }, x.k),
                el('p', {}, `くんよみ：${x.kun.join('、') || 'なし'}`),
                el('p', {}, `おんよみ：${x.on.join('、') || 'なし'}`),
                el('ul', {}, x.examples.map(ex => el('li', {}, `${ex.word}（${ex.pre}${ex.yomi}${ex.post}）`))),
                Object.keys(TRACKS).map(t => el('p', { class: 'count' }, countText(t))),
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
            el(
                'div',
                { class: 'tabs' },
                Object.keys(TRACKS).map(t =>
                    el(
                        'button',
                        { class: `tab ${t}${t === track ? ' active' : ''}`, onclick: () => showCollection(player, t) },
                        `${TRACKS[t].label}の まきもの`
                    )
                )
            ),
            el('p', { class: 'lead' }, `あつめた ${c.got} / ${c.total}　きん ${c.gold}`),
            track === 'write' && el('p', { class: 'hint' }, '「□に はいる かんじは？」に せいかいすると あつまるよ'),
            el(
                'div',
                { class: 'legend' },
                LEVELS.slice(1).map((l, i) => el('span', {}, scrollBadge('字', i + 1, track), l.label, `（${l.min}かい）`))
            ),
            el(
                'div',
                { class: 'grid' },
                list.map(x => {
                    const b = scrollBadge(x.k, levelOf(scrolls[x.k] || 0), track);
                    b.addEventListener('click', () => openDetail(x));
                    return b;
                })
            ),
            detail
        )
    );
}

// ===== かんじあわせ（神経衰弱） =====

function startMatch(player) {
    const pool = kanjiByGrade(player.grade);
    const game = `match-g${player.grade}`;
    const set = pickMatchSet(pool, MATCH_PAIRS);
    const cards = shuffle(
        set.flatMap((s, pair) => [
            { pair, kind: 'kanji', face: s.kanji.k },
            { pair, kind: 'yomi', face: s.label.text },
        ])
    );
    const state = { open: [], matched: 0, moves: 0, locked: false };
    const timers = [];
    const movesView = el('strong', {}, '0');
    const best = getBest(player.id, game);

    const finish = () => {
        const isBest = saveBestIfBetter(player.id, game, state.moves);
        playChime();
        screen.append(
            el(
                'div',
                { class: 'overlay' },
                el(
                    'div',
                    { class: 'detail-card' },
                    el('h2', {}, 'ぜんぶ そろった！'),
                    el('p', { class: 'lead dark' }, `${state.moves}かいで クリア`),
                    isBest
                        ? el('p', { class: 'best-new' }, best === null ? 'はじめての きろく！' : `じこベスト こうしん！（まえは ${best}かい）`)
                        : el('p', {}, `じこベストは ${best}かい`),
                    el('div', { class: 'scroll-row center' }, set.map(s => scrollBadge(s.kanji.k, levelOf(getScrolls(player.id)[s.kanji.k] || 0)))),
                    el(
                        'div',
                        { class: 'actions' },
                        el('button', { class: 'btn primary', onclick: () => startMatch(player) }, 'もういっかい'),
                        el('button', { class: 'btn', onclick: showHome }, 'もどる')
                    )
                )
            )
        );
    };

    const flip = (card, button) => {
        if (state.locked || card.open || card.done) return;
        card.open = true;
        button.classList.add('open');
        state.open.push({ card, button });
        if (state.open.length < 2) return;

        state.moves++;
        movesView.textContent = String(state.moves);
        const [a, b] = state.open;
        state.open = [];
        if (a.card.pair === b.card.pair) {
            a.card.done = b.card.done = true;
            a.button.classList.add('done');
            b.button.classList.add('done');
            addScroll(player.id, set[a.card.pair].kanji.k);
            playCorrect();
            state.matched++;
            if (state.matched === set.length) timers.push(setTimeout(finish, 600));
            return;
        }
        // そろわなかったら少し見せてから裏返す
        state.locked = true;
        timers.push(
            setTimeout(() => {
                for (const x of [a, b]) {
                    x.card.open = false;
                    x.button.classList.remove('open');
                }
                state.locked = false;
            }, 1000)
        );
    };

    const screen = el(
        'main',
        { class: 'match' },
        el(
            'header',
            {},
            el('button', { class: 'back', onclick: showHome }, '← やめる'),
            el('span', {}, 'めくった かいすう ', movesView, best !== null ? `（ベスト ${best}）` : '')
        ),
        el('p', { class: 'ask' }, 'かんじと よみかたを そろえよう'),
        el(
            'div',
            { class: 'match-grid' },
            cards.map(card => {
                const button = el(
                    'button',
                    { class: `mcard ${card.kind}` },
                    el('span', { class: 'back-face' }, '忍'),
                    el('span', { class: 'front-face' }, card.face)
                );
                button.addEventListener('click', () => flip(card, button));
                return button;
            })
        ),
        el('p', { class: 'hint' }, 'ひらがなは くんよみ、カタカナは おんよみ')
    );
    show(screen);
    cleanup = () => timers.forEach(clearTimeout);
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
        const q = buildMixedQuestion(kanji, side.pool);
        const qv = questionView(q);
        const choices = el('div', { class: 'choices' });
        for (const c of q.choices) {
            const b = choiceButton(q, c);
            b.addEventListener('click', () => {
                if (!running || Date.now() < side.lockedUntil) return;
                if (c === q.answer) {
                    side.score++;
                    addScroll(side.player.id, kanji.k, q.type);
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
            el('p', { class: 'ask small' }, qv.ask),
            qv.view,
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
