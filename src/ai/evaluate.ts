import { scoreRoundEnd, winner } from '../engine/rules';
import { COLOR_MASK, COL_MASK, ROW_MASK, RUN, colBits, placementScore, popcount, rowBits, runScore } from '../engine/scoring';
import { OVER, P_LCOLOR, P_LCOUNT, P_SCORE, P_WALL, STARTER, pOff, wallCol, type State } from '../engine/state';

export interface Weights {
  /** 未完成パターンライン: 充填率 × 置いたときの得点 × この係数 */
  partialLine: number;
  /** 未完成パターンラインの固定価値(充填率に比例) */
  partialFlat: number;
  /** 横列ボーナス(2点)の進捗 [壁に並んだ枚数 0..4] に対する達成見込み */
  row: number[];
  /** 縦列ボーナス(7点) */
  col: number[];
  /** 色ボーナス(10点) */
  color: number[];
  /** 残りラウンドで揃えられない場合の見込み倍率 */
  infeasible: number;
  /** 空きマスに置いたときの追加得点ポテンシャル × 残りラウンド比 */
  adjacency: number;
  /** 次ラウンドの先手 */
  firstToken: number;
  /** ゲーム終了局面での勝ち/負けボーナス */
  win: number;
  /** 深さ制限の葉でラウンド終了まで貪欲プレイアウトしてから評価する(0/1) */
  playout: number;
}

export const DEFAULT_WEIGHTS: Weights = {
  partialLine: 0.5,
  partialFlat: 0.5,
  row: [0, 0.05, 0.15, 0.35, 0.6],
  col: [0, 0.1, 0.25, 0.5, 0.75],
  color: [0, 0.1, 0.25, 0.5, 0.75],
  infeasible: 0.3,
  adjacency: 1.0,
  firstToken: 1,
  win: 1000,
  playout: 1,
};

const rowsTmp = new Int32Array(5);
const colsTmp = new Int32Array(5);

/** 壁と未完成パターンラインから、将来得点の見込みを返す(現在の得点を含む) */
function playerValue(s: State, p: number, roundsLeft: number, W: Weights): number {
  const o = pOff(p);
  const wall = s[o + P_WALL];
  let v = s[o + P_SCORE];

  for (let row = 0; row < 5; row++) {
    const cnt = s[o + P_LCOUNT + row];
    if (cnt === 0) continue;
    const frac = cnt / (row + 1);
    const col = wallCol(row, s[o + P_LCOLOR + row]);
    v += frac * (W.partialLine * placementScore(wall, row, col) + W.partialFlat);
  }

  for (let i = 0; i < 5; i++) {
    const r = popcount(wall & ROW_MASK[i]);
    if (r > 0 && r < 5) v += 2 * W.row[r] * (5 - r <= roundsLeft ? 1 : W.infeasible);
    const c = popcount(wall & COL_MASK[i]);
    if (c > 0 && c < 5) v += 7 * W.col[c] * (5 - c <= roundsLeft * 2 ? 1 : W.infeasible);
    const k = popcount(wall & COLOR_MASK[i]);
    if (k > 0 && k < 5) v += 10 * W.color[k] * (5 - k <= roundsLeft * 2 ? 1 : W.infeasible);
  }

  if (W.adjacency !== 0) {
    let pot = 0;
    for (let i = 0; i < 5; i++) {
      rowsTmp[i] = rowBits(wall, i);
      colsTmp[i] = colBits(wall, i);
    }
    for (let row = 0; row < 5; row++) {
      const rb = rowsTmp[row];
      if (rb === 31) continue;
      for (let col = 0; col < 5; col++) {
        if ((rb >> col) & 1) continue;
        pot += runScore(RUN[rb * 5 + col], RUN[colsTmp[col] * 5 + row]) - 1;
      }
    }
    v += W.adjacency * pot * Math.min(1, roundsLeft / 4);
  }
  return v;
}

/**
 * 局面の評価値(perspective 視点、点差スケール)。
 * ラウンド途中なら「今ラウンドを終えた場合」を仮定して壁配置・減点を行ってから評価する。
 * exact=true はラウンドが実際に終わった局面(= ゲーム終了なら確定値)。
 */
export function evaluate(s: State, perspective: number, scratch: State, W: Weights, exact: boolean): number {
  scratch.set(s);
  scoreRoundEnd(scratch);
  const me = pOff(perspective);
  const opp = pOff(1 - perspective);
  if (scratch[OVER]) {
    const diff = scratch[me + P_SCORE] - scratch[opp + P_SCORE];
    const w = winner(scratch);
    if (w < 0) return diff;
    // 途中局面からの仮定の終局は確定ではないので勝敗ボーナスを弱める
    const win = exact ? W.win : W.win * 0.25;
    return diff + (w === perspective ? win : -win);
  }
  let maxRow = 0;
  for (let p = 0; p < 2; p++) {
    const wall = scratch[pOff(p) + P_WALL];
    for (let i = 0; i < 5; i++) {
      const r = popcount(wall & ROW_MASK[i]);
      if (r > maxRow) maxRow = r;
    }
  }
  const roundsLeft = Math.max(1, 5 - maxRow);
  let v = playerValue(scratch, perspective, roundsLeft, W) - playerValue(scratch, 1 - perspective, roundsLeft, W);
  v += scratch[STARTER] === perspective ? W.firstToken : -W.firstToken;
  return v;
}
