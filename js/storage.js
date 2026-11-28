/**
 * 保存まわり。GitHub Pages では同じユーザーのリポジトリが同じオリジンになり、
 * 計算忍者と localStorage を共有するので、キーには必ず PREFIX を付ける。
 */

const PREFIX = 'kanjiNinpocho.';

const DEFAULT_PLAYERS = [
    { id: 'p1', name: 'にんじゃ1', grade: 3 },
    { id: 'p2', name: 'にんじゃ2', grade: 1 },
];

function read(key, fallback) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
        // プライベートブラウズなどで保存できなくても遊べるようにする
    }
}

export function getPlayers() {
    const players = read('players', null);
    if (
        Array.isArray(players) &&
        players.length === DEFAULT_PLAYERS.length &&
        players.every(p => p && typeof p.name === 'string' && p.id)
    ) {
        return players;
    }
    return DEFAULT_PLAYERS.map(p => ({ ...p }));
}

export function savePlayers(players) {
    write('players', players);
}

export function getScrolls(playerId) {
    const data = read(`scrolls.${playerId}`, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

/**
 * ミニゲームの自己ベスト（小さいほどよい記録）。
 */
export function getBest(playerId, game) {
    const value = read(`best.${game}.${playerId}`, null);
    return Number.isFinite(value) ? value : null;
}

/**
 * 自己ベストを更新できたら保存して true。
 */
export function saveBestIfBetter(playerId, game, value) {
    const best = getBest(playerId, game);
    if (best !== null && best <= value) return false;
    write(`best.${game}.${playerId}`, value);
    return true;
}

/**
 * 正解を1回記録する。巻物が育ったかの判定用に前後の回数を返す。
 */
export function addScroll(playerId, k) {
    const scrolls = getScrolls(playerId);
    const before = scrolls[k] || 0;
    scrolls[k] = before + 1;
    write(`scrolls.${playerId}`, scrolls);
    return { before, after: before + 1 };
}
