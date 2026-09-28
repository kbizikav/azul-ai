import { applyMove, generateMoves, placeableRows, roundOver, sameFactory } from '../engine/rules';
import { floorPenalty, placementScore } from '../engine/scoring';
import {
  CENTER,
  CTR,
  CTR_FIRST,
  CUR,
  FACT,
  FLOOR_DEST,
  MAX_MOVE,
  NEXT_FIRST,
  NUM_COLORS,
  P_FLOOR_LEN,
  P_LCOLOR,
  P_LCOUNT,
  P_SCORE,
  P_WALL,
  STATE_SIZE,
  moveColor,
  moveDest,
  moveSrc,
  pOff,
  wallCol,
  type Move,
  type State,
} from '../engine/state';
import { DEFAULT_WEIGHTS, evaluate, type Weights } from './evaluate';

// ラウンド内はランダム要素がない完全情報ゲームなので、ラウンド終了までを αβ で読む。
// ラウンド終了局面(または深さ制限の葉)は評価関数で評価する。

export interface SearchOptions {
  timeMs: number;
  maxDepth?: number;
  weights?: Weights;
}

export interface SearchResult {
  move: Move;
  /** 手番側視点の評価値(点差スケール) */
  score: number;
  depth: number;
  nodes: number;
  /** ラウンド終了まで読み切ったか */
  solved: boolean;
  timeMs: number;
}

const MAX_PLY = 48;
const MAX_MOVES = 256;
const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const FLAG_EXACT = 0;
const FLAG_LOWER = 1;
const FLAG_UPPER = 2;
const FLAG_SOLVED = 4;
const NULL_WINDOW = 1e-6;

// ハッシュに使うインデックス(袋・箱・床の色・乱数はラウンド内の探索に無関係)
const HASH_IDX: Int32Array = (() => {
  const idx: number[] = [];
  for (let i = FACT; i <= CTR_FIRST; i++) idx.push(i);
  idx.push(CUR, NEXT_FIRST);
  for (let p = 0; p < 2; p++) {
    const o = pOff(p);
    idx.push(o + P_SCORE, o + P_WALL, o + P_FLOOR_LEN);
    for (let r = 0; r < 5; r++) idx.push(o + P_LCOLOR + r, o + P_LCOUNT + r);
  }
  return Int32Array.from(idx);
})();

class AbortSearch extends Error {}

/** 手の並べ替え用の簡易スコア(大きいほど有望) */
export function quickMoveScore(s: State, m: Move): number {
  const src = moveSrc(m);
  const color = moveColor(m);
  const dest = moveDest(m);
  const o = pOff(s[CUR]);
  const n = src < CENTER ? s[FACT + src * NUM_COLORS + color] : s[CTR + color];
  const takesFirst = src === CENTER && s[CTR_FIRST] === 1 ? 1 : 0;
  const floorLen = s[o + P_FLOOR_LEN];
  let sc = 0;
  let overflow = n;
  if (dest < FLOOR_DEST) {
    const space = dest + 1 - s[o + P_LCOUNT + dest];
    const placed = n < space ? n : space;
    overflow = n - placed;
    sc += placed * 0.5;
    if (placed === space) sc += 1 + placementScore(s[o + P_WALL], dest, wallCol(dest, color));
    else sc += (0.5 * (s[o + P_LCOUNT + dest] + placed)) / (dest + 1);
  } else {
    sc -= 2;
  }
  sc += floorPenalty(floorLen + overflow + takesFirst) - floorPenalty(floorLen);
  return sc;
}

const rowsTmp = new Int32Array(NUM_COLORS);

/**
 * 合法手と quickMoveScore を同時に求める(generateMoves + quickMoveScore と同じ結果をより速く)。
 * dedupe=true なら中身が同じ工場は最初の 1 つだけ展開する。
 */
export function generateScoredMoves(s: State, moves: Int32Array, scores: Float64Array, dedupe: boolean): number {
  const player = s[CUR];
  const o = pOff(player);
  const wall = s[o + P_WALL];
  const floorLen = s[o + P_FLOOR_LEN];
  const basePen = floorPenalty(floorLen);
  placeableRows(s, player, rowsTmp);
  let n = 0;
  for (let src = 0; src <= CENTER; src++) {
    const base = src < CENTER ? FACT + src * NUM_COLORS : CTR;
    if (dedupe && src < CENTER) {
      if ((s[base] | s[base + 1] | s[base + 2] | s[base + 3] | s[base + 4]) === 0) continue;
      let dup = false;
      for (let g = 0; g < src && !dup; g++) dup = sameFactory(s, g, src);
      if (dup) continue;
    }
    const first = src === CENTER && s[CTR_FIRST] === 1 ? 1 : 0;
    for (let color = 0; color < NUM_COLORS; color++) {
      const cnt = s[base + color];
      if (cnt === 0) continue;
      const mask = rowsTmp[color];
      const mbase = src * 30 + color * 6;
      for (let row = 0; row < 5; row++) {
        if (!((mask >> row) & 1)) continue;
        const have = s[o + P_LCOUNT + row];
        const space = row + 1 - have;
        const placed = cnt < space ? cnt : space;
        let sc = placed * 0.5;
        if (placed === space) sc += 1 + placementScore(wall, row, wallCol(row, color));
        else sc += (0.5 * (have + placed)) / (row + 1);
        scores[n] = sc + floorPenalty(floorLen + cnt - placed + first) - basePen;
        moves[n++] = mbase + row;
      }
      scores[n] = -2 + floorPenalty(floorLen + cnt + first) - basePen;
      moves[n++] = mbase + FLOOR_DEST;
    }
  }
  return n;
}

const pMoves = new Int32Array(256);
const pScores = new Float64Array(256);

/** quickMoveScore が最大の手 */
export function greedyPlayoutMove(s: State): Move {
  const n = generateScoredMoves(s, pMoves, pScores, false);
  let bi = 0;
  for (let i = 1; i < n; i++) if (pScores[i] > pScores[bi]) bi = i;
  return pMoves[bi];
}

export class Searcher {
  private readonly bufs: State[] = [];
  private readonly moveLists: Int32Array[] = [];
  private readonly orderLists: Float64Array[] = [];
  private readonly scratch: State = new Int32Array(STATE_SIZE);
  private readonly playoutBuf: State = new Int32Array(STATE_SIZE);
  private readonly ttKey = new Int32Array(TT_SIZE);
  private readonly ttKey2 = new Int32Array(TT_SIZE);
  private readonly ttVal = new Float64Array(TT_SIZE);
  private readonly ttDepth = new Int8Array(TT_SIZE);
  private readonly ttFlag = new Uint8Array(TT_SIZE);
  private readonly ttMove = new Int16Array(TT_SIZE).fill(-1);
  private readonly history = new Float64Array(MAX_MOVE * 2);
  private readonly killers = new Int16Array(MAX_PLY * 2).fill(-1);
  private W: Weights = DEFAULT_WEIGHTS;
  private nodes = 0;
  private depthCuts = 0;
  private deadline = 0;
  private h1 = 0;
  private h2 = 0;

  constructor() {
    for (let i = 0; i <= MAX_PLY; i++) {
      this.bufs.push(new Int32Array(STATE_SIZE));
      this.moveLists.push(new Int32Array(MAX_MOVES));
      this.orderLists.push(new Float64Array(MAX_MOVES));
    }
  }

  search(root: State, opts: SearchOptions): SearchResult {
    const start = performance.now();
    this.W = opts.weights ?? DEFAULT_WEIGHTS;
    this.nodes = 0;
    this.deadline = start + opts.timeMs;
    this.killers.fill(-1);
    for (let i = 0; i < this.history.length; i++) this.history[i] *= 0.125;
    const maxDepth = Math.min(opts.maxDepth ?? MAX_PLY - 1, MAX_PLY - 1);

    const s0 = this.bufs[0];
    s0.set(root);
    const moves = this.moveLists[0];
    const n = generateMoves(s0, moves, true);
    if (n === 0) throw new Error('no legal moves');
    const rootMoves = Array.from(moves.subarray(0, n));
    const rootScores = rootMoves.map((m) => quickMoveScore(s0, m));
    let best: SearchResult = {
      move: rootMoves[rootScores.indexOf(Math.max(...rootScores))],
      score: 0,
      depth: 0,
      nodes: 0,
      solved: false,
      timeMs: 0,
    };
    if (n === 1) {
      best.timeMs = performance.now() - start;
      return best;
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
      // 前の反復の評価順に並べ替え
      const order = rootMoves.map((m, i) => ({ m, sc: rootScores[i] })).sort((a, b) => b.sc - a.sc);
      this.depthCuts = 0;
      let alpha = -Infinity;
      const beta = Infinity;
      let iterBest = order[0].m;
      try {
        for (let i = 0; i < order.length; i++) {
          const m = order[i].m;
          const child = this.bufs[1];
          child.set(s0);
          applyMove(child, m);
          let v: number;
          if (i === 0) {
            v = -this.negamax(1, depth - 1, -beta, -alpha);
          } else {
            v = -this.negamax(1, depth - 1, -alpha - NULL_WINDOW, -alpha);
            if (v > alpha) v = -this.negamax(1, depth - 1, -beta, -alpha);
          }
          order[i].sc = v;
          if (v > alpha) {
            alpha = v;
            iterBest = m;
          }
        }
      } catch (e) {
        if (!(e instanceof AbortSearch)) throw e;
        // 途中まででも、前反復の最善手より良いと確定した手があれば採用する
        if (iterBest !== order[0].m && alpha > best.score) {
          best = { ...best, move: iterBest, score: alpha };
        }
        break;
      }
      for (let i = 0; i < order.length; i++) {
        rootMoves[i] = order[i].m;
        // 評価が確定しなかった手(null window で弾かれた手)は下限値しかないが並べ替えには十分
        rootScores[i] = order[i].sc;
      }
      const solved = this.depthCuts === 0;
      best = { move: iterBest, score: alpha, depth, nodes: this.nodes, solved, timeMs: 0 };
      if (solved) break;
      if (performance.now() - start > opts.timeMs * 0.45) break;
    }
    best.nodes = this.nodes;
    best.timeMs = performance.now() - start;
    return best;
  }

  /** 両者が簡易スコア最大の手を指し続けてラウンドを終わらせ、その局面を評価する */
  private playout(s: State): number {
    const persp = s[CUR];
    const p = this.playoutBuf;
    p.set(s);
    while (!roundOver(p)) applyMove(p, greedyPlayoutMove(p));
    return evaluate(p, persp, this.scratch, this.W, false);
  }

  private hash(s: State): void {
    let h1 = 0x811c9dc5 | 0;
    let h2 = 0x6a09e667 | 0;
    for (let i = 0; i < HASH_IDX.length; i++) {
      const v = s[HASH_IDX[i]] + 7;
      h1 = Math.imul(h1 ^ v, 16777619);
      h2 = Math.imul(h2 ^ (v + i * 131), 0x9e3779b1);
      h2 ^= h2 >>> 15;
    }
    this.h1 = h1 ^ (h1 >>> 13);
    this.h2 = h2;
  }

  private negamax(ply: number, depth: number, alpha: number, beta: number): number {
    const s = this.bufs[ply];
    if ((++this.nodes & 2047) === 0 && performance.now() > this.deadline) throw new AbortSearch();

    if (roundOver(s)) return evaluate(s, s[CUR], this.scratch, this.W, true);
    if (depth <= 0 || ply >= MAX_PLY - 1) {
      this.depthCuts++;
      if (this.W.playout) return this.playout(s);
      return evaluate(s, s[CUR], this.scratch, this.W, false);
    }

    this.hash(s);
    const h1 = this.h1;
    const h2 = this.h2;
    const idx = h1 & TT_MASK;
    let ttMove = -1;
    if (this.ttKey[idx] === h1 && this.ttKey2[idx] === h2) {
      ttMove = this.ttMove[idx];
      const flag = this.ttFlag[idx];
      const solved = (flag & FLAG_SOLVED) !== 0;
      if (solved || this.ttDepth[idx] >= depth) {
        const v = this.ttVal[idx];
        const kind = flag & 3;
        if (kind === FLAG_EXACT || (kind === FLAG_LOWER && v >= beta) || (kind === FLAG_UPPER && v <= alpha)) {
          if (!solved) this.depthCuts++;
          return v;
        }
      }
    }

    const moves = this.moveLists[ply];
    const order = this.orderLists[ply];
    const n = generateScoredMoves(s, moves, order, true);
    const player = s[CUR];
    const hist = this.history;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      let sc = order[i] + hist[player * MAX_MOVE + m] * 0.001;
      if (m === ttMove) sc += 1e6;
      else if (m === k1) sc += 50;
      else if (m === k2) sc += 40;
      order[i] = sc;
    }

    const alpha0 = alpha;
    const cuts0 = this.depthCuts;
    let best = -Infinity;
    let bestMove = -1;
    const child = this.bufs[ply + 1];
    for (let i = 0; i < n; i++) {
      // 残りから最良の手を選ぶ(選択ソート)
      let bi = i;
      for (let j = i + 1; j < n; j++) if (order[j] > order[bi]) bi = j;
      const m = moves[bi];
      moves[bi] = moves[i];
      moves[i] = m;
      const tmp = order[bi];
      order[bi] = order[i];
      order[i] = tmp;

      child.set(s);
      applyMove(child, m);
      let v: number;
      if (i === 0) {
        v = -this.negamax(ply + 1, depth - 1, -beta, -alpha);
      } else {
        v = -this.negamax(ply + 1, depth - 1, -alpha - NULL_WINDOW, -alpha);
        if (v > alpha && v < beta) v = -this.negamax(ply + 1, depth - 1, -beta, -alpha);
      }
      if (v > best) {
        best = v;
        bestMove = m;
        if (v > alpha) {
          alpha = v;
          if (alpha >= beta) {
            hist[player * MAX_MOVE + m] += depth * depth;
            if (this.killers[ply * 2] !== m) {
              this.killers[ply * 2 + 1] = this.killers[ply * 2];
              this.killers[ply * 2] = m;
            }
            break;
          }
        }
      }
    }

    const flag = best <= alpha0 ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
    this.ttKey[idx] = h1;
    this.ttKey2[idx] = h2;
    this.ttVal[idx] = best;
    this.ttDepth[idx] = depth;
    this.ttFlag[idx] = flag | (this.depthCuts === cuts0 ? FLAG_SOLVED : 0);
    this.ttMove[idx] = bestMove;
    return best;
  }
}

/** 1 手読み + 簡易スコアの貪欲 AI(かんたんモード / ベンチマーク用) */
export function greedyMove(s: State, noise = 0, rnd: () => number = Math.random): Move {
  const moves: Move[] = [];
  generateMoves(s, moves);
  let best = moves[0];
  let bestSc = -Infinity;
  for (const m of moves) {
    const sc = quickMoveScore(s, m) + noise * rnd();
    if (sc > bestSc) {
      bestSc = sc;
      best = m;
    }
  }
  return best;
}
