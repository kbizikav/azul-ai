import { describe, expect, it } from 'vitest';
import { advance, applyMove, canPlace, legalMoves, newGame, roundOver, scoreRoundEnd, winner } from '../src/engine/rules';
import { bit, endGameBonus, floorPenalty, placementScore } from '../src/engine/scoring';
import {
  BAG,
  BOX,
  CENTER,
  CTR,
  CTR_FIRST,
  CUR,
  FACT,
  FIRST_TOKEN,
  FLOOR_DEST,
  NEXT_FIRST,
  OVER,
  P_FLOOR,
  P_FLOOR_LEN,
  P_LCOLOR,
  P_LCOUNT,
  P_SCORE,
  P_WALL,
  ROUND,
  STARTER,
  encodeMove,
  pOff,
  wallCol,
  type State,
} from '../src/engine/state';

function clearTable(s: State): void {
  for (let i = FACT; i < CTR + 5; i++) s[i] = 0;
}

function totalTiles(s: State): number {
  let n = 0;
  for (let i = FACT; i < CTR + 5; i++) n += s[i];
  for (let c = 0; c < 5; c++) n += s[BAG + c] + s[BOX + c];
  for (let p = 0; p < 2; p++) {
    const o = pOff(p);
    for (let r = 0; r < 5; r++) {
      n += s[o + P_LCOUNT + r];
      for (let c = 0; c < 5; c++) if (s[o + P_WALL] & bit(r, c)) n++;
    }
    for (let i = 0; i < s[o + P_FLOOR_LEN]; i++) if (s[o + P_FLOOR + i] !== FIRST_TOKEN) n++;
  }
  return n;
}

describe('scoring', () => {
  it('単独のタイルは1点', () => {
    expect(placementScore(0, 2, 2)).toBe(1);
  });
  it('横に連結', () => {
    const wall = bit(0, 0) | bit(0, 1);
    expect(placementScore(wall, 0, 2)).toBe(3);
  });
  it('縦横両方に連結すると両方数える', () => {
    const wall = bit(1, 1) | bit(1, 3) | bit(0, 2) | bit(3, 2);
    // 横: (1,1)(1,2)(1,3) = 3, 縦: (0,2)(1,2) = 2
    expect(placementScore(wall, 1, 2)).toBe(5);
  });
  it('床の減点', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(floorPenalty)).toEqual([0, -1, -2, -4, -6, -8, -11, -14]);
  });
  it('終了ボーナス', () => {
    let wall = 0;
    for (let c = 0; c < 5; c++) wall |= bit(0, c); // 横1列
    for (let r = 0; r < 5; r++) wall |= bit(r, 0); // 縦1列
    for (let r = 0; r < 5; r++) wall |= bit(r, wallCol(r, 2)); // 赤5枚
    const b = endGameBonus(wall);
    expect(b).toMatchObject({ rows: 1, cols: 1, colors: 1, total: 19 });
  });
});

describe('rules', () => {
  it('初期配置: 工場5枚×4タイル', () => {
    const s = newGame(1);
    for (let f = 0; f < 5; f++) {
      let n = 0;
      for (let c = 0; c < 5; c++) n += s[FACT + f * 5 + c];
      expect(n).toBe(4);
    }
    expect(s[CTR_FIRST]).toBe(1);
    expect(s[ROUND]).toBe(1);
    expect(totalTiles(s)).toBe(100);
  });

  it('工場から取ると残りは中央へ', () => {
    const s = newGame(1);
    clearTable(s);
    s[FACT + 0] = 2; // 青2
    s[FACT + 2] = 2; // 赤2
    applyMove(s, encodeMove(0, 0, 1));
    expect(s[CTR + 2]).toBe(2);
    expect(s[pOff(0) + P_LCOUNT + 1]).toBe(2);
    expect(s[pOff(0) + P_LCOLOR + 1]).toBe(0);
    expect(s[CUR]).toBe(1);
  });

  it('中央から最初に取ると先手マーカーが床へ、溢れも床へ', () => {
    const s = newGame(1);
    clearTable(s);
    s[CTR + 3] = 3;
    s[CUR] = 1;
    applyMove(s, encodeMove(CENTER, 3, 0));
    const o = pOff(1);
    expect(s[o + P_LCOUNT]).toBe(1);
    expect(s[o + P_FLOOR_LEN]).toBe(3);
    expect(s[o + P_FLOOR]).toBe(FIRST_TOKEN);
    expect(s[NEXT_FIRST]).toBe(1);
    expect(s[CTR_FIRST]).toBe(0);
  });

  it('壁に同色がある行・別色の行には置けない', () => {
    const s = newGame(1);
    const o = pOff(0);
    s[o + P_WALL] = bit(2, wallCol(2, 1));
    expect(canPlace(s, 0, 1, 2)).toBe(false);
    s[o + P_LCOLOR + 3] = 4;
    s[o + P_LCOUNT + 3] = 1;
    expect(canPlace(s, 0, 0, 3)).toBe(false);
    expect(canPlace(s, 0, 4, 3)).toBe(true);
    s[o + P_LCOUNT + 3] = 4;
    expect(canPlace(s, 0, 4, 3)).toBe(false); // 満杯
  });

  it('ラウンド終了: 壁配置・得点・床減点・先手交代', () => {
    const s = newGame(1);
    clearTable(s);
    const o = pOff(0);
    s[o + P_LCOLOR + 0] = 0;
    s[o + P_LCOUNT + 0] = 1;
    s[o + P_LCOLOR + 1] = 0;
    s[o + P_LCOUNT + 1] = 2;
    s[o + P_LCOLOR + 2] = 2;
    s[o + P_LCOUNT + 2] = 1; // 未完成は残る
    s[o + P_FLOOR_LEN] = 2;
    s[o + P_FLOOR] = FIRST_TOKEN;
    s[o + P_FLOOR + 1] = 3;
    s[NEXT_FIRST] = 0;
    s[STARTER] = 1;
    scoreRoundEnd(s);
    // 青: (0,0) 1点、(1,1) は (0,0) と縦に繋がらない(列が違う)ので 1点
    expect(s[o + P_WALL]).toBe(bit(0, 0) | bit(1, 1));
    expect(s[o + P_SCORE]).toBe(0); // 2 - 2 = 0
    expect(s[o + P_LCOUNT + 2]).toBe(1);
    expect(s[o + P_FLOOR_LEN]).toBe(0);
    expect(s[STARTER]).toBe(0);
    expect(s[CUR]).toBe(0);
  });

  it('得点は0未満にならない', () => {
    const s = newGame(1);
    clearTable(s);
    const o = pOff(1);
    s[o + P_FLOOR_LEN] = 7;
    for (let i = 0; i < 7; i++) s[o + P_FLOOR + i] = 1;
    scoreRoundEnd(s);
    expect(s[o + P_SCORE]).toBe(0);
  });

  it('横1列完成でゲーム終了しボーナス加算', () => {
    const s = newGame(1);
    clearTable(s);
    const o = pOff(0);
    s[o + P_WALL] = bit(4, 0) | bit(4, 1) | bit(4, 2) | bit(4, 3);
    const color = (4 - 4 + 5) % 5; // (4,4) の色
    s[o + P_LCOLOR + 4] = color;
    s[o + P_LCOUNT + 4] = 5;
    scoreRoundEnd(s);
    expect(s[OVER]).toBe(1);
    expect(s[o + P_SCORE]).toBe(5 + 2);
    expect(winner(s)).toBe(0);
  });

  it('ランダム対局が最後まで進み、タイル総数が保存される', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(seed, seed % 2);
      let rnd = seed * 7919;
      let guard = 0;
      while (!s[OVER]) {
        const moves = legalMoves(s);
        expect(moves.length).toBeGreaterThan(0);
        rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
        advance(s, moves[rnd % moves.length]);
        expect(totalTiles(s)).toBe(100);
        expect(++guard).toBeLessThan(1000);
      }
      expect(roundOver(s)).toBe(true);
    }
  });

  it('床への手は常に合法', () => {
    const s = newGame(3);
    const moves = legalMoves(s);
    expect(moves.some((m) => m % 6 === FLOOR_DEST)).toBe(true);
  });
});
