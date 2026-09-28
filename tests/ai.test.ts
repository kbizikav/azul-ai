import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, evaluate } from '../src/ai/evaluate';
import { Searcher, generateScoredMoves, quickMoveScore } from '../src/ai/search';
import { advance, applyMove, generateMoves, legalMoves, newGame, roundOver } from '../src/engine/rules';
import { CENTER, CTR, CTR_FIRST, CUR, FACT, NUM_COLORS, OVER, STATE_SIZE, encodeMove, moveDest, type State } from '../src/engine/state';

const scratch = new Int32Array(STATE_SIZE);

/** 枝刈りなしの全探索(ラウンド終了まで) */
function minimax(s: State): number {
  if (roundOver(s)) return evaluate(s, s[CUR], scratch, DEFAULT_WEIGHTS, true);
  const moves: number[] = [];
  generateMoves(s, moves);
  let best = -Infinity;
  for (const m of moves) {
    const c = s.slice();
    applyMove(c, m);
    const v = -minimax(c);
    if (v > best) best = v;
  }
  return best;
}

function groupsLeft(s: State): number {
  let n = 0;
  for (let i = FACT; i < CTR + NUM_COLORS; i++) if (s[i]) n++;
  return n;
}

describe('search', () => {
  it('ラウンド終盤の読み切り値が全探索と一致する', () => {
    const searcher = new Searcher();
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 12; seed++) {
      const s = newGame(seed, seed % 2);
      let r = seed * 48271;
      // ラウンドの途中(残りグループが少ない局面)まで適当に進める
      while (!s[OVER] && groupsLeft(s) > 4) {
        const moves = legalMoves(s);
        r = (r * 1103515245 + 12345) & 0x7fffffff;
        advance(s, moves[r % moves.length]);
      }
      if (s[OVER] || roundOver(s)) continue;
      const res = searcher.search(s, { timeMs: 10000 });
      expect(res.solved).toBe(true);
      expect(res.score).toBeCloseTo(minimax(s), 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('床に捨てずに段を完成させる手を選ぶ', () => {
    const s = newGame(7);
    for (let i = FACT; i < CTR + NUM_COLORS; i++) s[i] = 0;
    s[CTR_FIRST] = 0;
    s[CTR + 2] = 3; // 中央に赤3枚だけ
    const res = new Searcher().search(s, { timeMs: 1000 });
    // 2段目(1枚溢れ)か3段目(ぴったり)のどちらかで段を完成させる
    expect([encodeMove(CENTER, 2, 1), encodeMove(CENTER, 2, 2)]).toContain(res.move);
  });

  it('generateScoredMoves は generateMoves + quickMoveScore と一致する', () => {
    const moves = new Int32Array(256);
    const scores = new Float64Array(256);
    for (let seed = 1; seed <= 10; seed++) {
      const s = newGame(seed);
      let r = seed;
      while (!s[OVER]) {
        const ref: number[] = [];
        generateMoves(s, ref, true);
        const n = generateScoredMoves(s, moves, scores, true);
        expect(Array.from(moves.subarray(0, n))).toEqual(ref);
        for (let i = 0; i < n; i++) expect(scores[i]).toBeCloseTo(quickMoveScore(s, moves[i]), 9);
        const all = legalMoves(s);
        r = (r * 1103515245 + 12345) & 0x7fffffff;
        advance(s, all[r % all.length]);
      }
    }
  });

  it('時間制限を守る', () => {
    const s = newGame(11);
    const t0 = performance.now();
    const res = new Searcher().search(s, { timeMs: 300 });
    expect(performance.now() - t0).toBeLessThan(600);
    expect(res.depth).toBeGreaterThanOrEqual(2);
    expect(moveDest(res.move)).toBeGreaterThanOrEqual(0);
  });
});
