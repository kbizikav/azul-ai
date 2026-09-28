import { rand } from './rng';
import { bit, completedRows, endGameBonus, floorPenalty, placementScore, type Bonus } from './scoring';
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
  FLOOR_SIZE,
  NEXT_FIRST,
  NUM_COLORS,
  NUM_FACTORIES,
  OVER,
  P_FLOOR,
  P_FLOOR_LEN,
  P_LCOLOR,
  P_LCOUNT,
  P_SCORE,
  P_WALL,
  RNG,
  ROUND,
  STARTER,
  STATE_SIZE,
  TILES_PER_COLOR,
  TILES_PER_FACTORY,
  moveColor,
  moveDest,
  moveSrc,
  pOff,
  wallCol,
  type Move,
  type State,
} from './state';

export function newGame(seed: number, starter = 0): State {
  const s = new Int32Array(STATE_SIZE);
  for (let c = 0; c < NUM_COLORS; c++) s[BAG + c] = TILES_PER_COLOR;
  s[RNG] = seed | 0;
  s[STARTER] = starter;
  s[NEXT_FIRST] = -1;
  for (let p = 0; p < 2; p++) {
    const o = pOff(p);
    for (let r = 0; r < 5; r++) s[o + P_LCOLOR + r] = -1;
  }
  startRound(s);
  return s;
}

function drawTile(s: State): number {
  let total = 0;
  for (let c = 0; c < NUM_COLORS; c++) total += s[BAG + c];
  if (total === 0) {
    for (let c = 0; c < NUM_COLORS; c++) {
      s[BAG + c] = s[BOX + c];
      s[BOX + c] = 0;
      total += s[BAG + c];
    }
    if (total === 0) return -1;
  }
  let x = Math.floor(rand(s) * total);
  for (let c = 0; c < NUM_COLORS; c++) {
    x -= s[BAG + c];
    if (x < 0) {
      s[BAG + c]--;
      return c;
    }
  }
  s[BAG + NUM_COLORS - 1]--;
  return NUM_COLORS - 1;
}

/** 工場にタイルを補充して新しいラウンドを始める */
export function startRound(s: State): void {
  for (let f = 0; f < NUM_FACTORIES; f++) {
    for (let i = 0; i < TILES_PER_FACTORY; i++) {
      const c = drawTile(s);
      if (c < 0) break;
      s[FACT + f * NUM_COLORS + c]++;
    }
  }
  s[CTR_FIRST] = 1;
  s[NEXT_FIRST] = -1;
  s[CUR] = s[STARTER];
  s[ROUND]++;
}

export function roundOver(s: State): boolean {
  for (let i = FACT; i < CTR + NUM_COLORS; i++) if (s[i] !== 0) return false;
  return true;
}

export function canPlace(s: State, player: number, color: number, row: number): boolean {
  const o = pOff(player);
  const cnt = s[o + P_LCOUNT + row];
  if (cnt >= row + 1) return false;
  if (cnt > 0 && s[o + P_LCOLOR + row] !== color) return false;
  return (s[o + P_WALL] & bit(row, wallCol(row, color))) === 0;
}

export function sameFactory(s: State, a: number, b: number): boolean {
  const oa = FACT + a * NUM_COLORS;
  const ob = FACT + b * NUM_COLORS;
  for (let c = 0; c < NUM_COLORS; c++) if (s[oa + c] !== s[ob + c]) return false;
  return true;
}

const rowMaskTmp = new Int32Array(NUM_COLORS);

/** 各色について、手番プレイヤーが置けるパターンラインのビットマスクを out に書き込む */
export function placeableRows(s: State, player: number, out: Int32Array): void {
  const o = pOff(player);
  const wall = s[o + P_WALL];
  for (let color = 0; color < NUM_COLORS; color++) out[color] = 0;
  for (let row = 0; row < 5; row++) {
    const cnt = s[o + P_LCOUNT + row];
    if (cnt >= row + 1) continue;
    const rowWall = wall >>> (row * 5);
    if (cnt > 0) {
      const color = s[o + P_LCOLOR + row];
      if (!((rowWall >>> wallCol(row, color)) & 1)) out[color] |= 1 << row;
    } else {
      for (let color = 0; color < NUM_COLORS; color++) {
        if (!((rowWall >>> wallCol(row, color)) & 1)) out[color] |= 1 << row;
      }
    }
  }
}

/**
 * 合法手を out に書き込み、その数を返す。
 * dedupe=true なら中身が同じ工場は最初の 1 つだけ展開する(AI 探索用)。
 */
export function generateMoves(s: State, out: Int32Array | Move[], dedupe = false): number {
  const rows = rowMaskTmp;
  placeableRows(s, s[CUR], rows);
  let n = 0;
  for (let src = 0; src <= CENTER; src++) {
    const base = src < CENTER ? FACT + src * NUM_COLORS : CTR;
    if (dedupe && src < CENTER) {
      if ((s[base] | s[base + 1] | s[base + 2] | s[base + 3] | s[base + 4]) === 0) continue;
      let dup = false;
      for (let g = 0; g < src && !dup; g++) dup = sameFactory(s, g, src);
      if (dup) continue;
    }
    for (let color = 0; color < NUM_COLORS; color++) {
      if (s[base + color] === 0) continue;
      const mask = rows[color];
      const mbase = src * 30 + color * 6;
      for (let row = 0; row < 5; row++) {
        if ((mask >> row) & 1) out[n++] = mbase + row;
      }
      out[n++] = mbase + FLOOR_DEST;
    }
  }
  return n;
}

export function legalMoves(s: State): Move[] {
  const out: Move[] = [];
  generateMoves(s, out);
  return out;
}

function addFloor(s: State, o: number, tile: number): void {
  const len = s[o + P_FLOOR_LEN];
  if (len < FLOOR_SIZE) {
    s[o + P_FLOOR + len] = tile;
    s[o + P_FLOOR_LEN] = len + 1;
  } else if (tile !== FIRST_TOKEN) {
    s[BOX + tile]++;
  }
}

/** 手を適用して手番を交代する(ラウンド終了処理は行わない) */
export function applyMove(s: State, m: Move): void {
  const src = moveSrc(m);
  const color = moveColor(m);
  const dest = moveDest(m);
  const p = s[CUR];
  const o = pOff(p);
  let n: number;
  if (src < CENTER) {
    const base = FACT + src * NUM_COLORS;
    n = s[base + color];
    for (let c = 0; c < NUM_COLORS; c++) {
      if (c !== color) s[CTR + c] += s[base + c];
      s[base + c] = 0;
    }
  } else {
    n = s[CTR + color];
    s[CTR + color] = 0;
    if (s[CTR_FIRST]) {
      s[CTR_FIRST] = 0;
      s[NEXT_FIRST] = p;
      addFloor(s, o, FIRST_TOKEN);
    }
  }
  let overflow = n;
  if (dest < FLOOR_DEST) {
    const space = dest + 1 - s[o + P_LCOUNT + dest];
    const placed = n < space ? n : space;
    s[o + P_LCOUNT + dest] += placed;
    s[o + P_LCOLOR + dest] = color;
    overflow = n - placed;
  }
  for (let i = 0; i < overflow; i++) addFloor(s, o, color);
  s[CUR] = 1 - p;
}

export interface Placement {
  row: number;
  col: number;
  color: number;
  points: number;
}

export interface PlayerRoundReport {
  placements: Placement[];
  floorPenalty: number;
  scoreBefore: number;
  scoreAfter: number;
  bonus?: Bonus;
}

export interface RoundReport {
  players: PlayerRoundReport[];
  gameOver: boolean;
}

/**
 * ラウンド終了処理: 壁へのタイル配置・得点・床の減点・次の先手決定。
 * 誰かが横 1 列を完成させていれば終了ボーナスを加算して OVER を立てる。
 * 補充(startRound)は行わない。
 */
export function scoreRoundEnd(s: State, report?: RoundReport): void {
  let anyRow = false;
  for (let p = 0; p < 2; p++) {
    const o = pOff(p);
    let wall = s[o + P_WALL];
    let score = s[o + P_SCORE];
    const pr: PlayerRoundReport | undefined = report
      ? { placements: [], floorPenalty: 0, scoreBefore: score, scoreAfter: 0 }
      : undefined;
    for (let row = 0; row < 5; row++) {
      if (s[o + P_LCOUNT + row] !== row + 1) continue;
      const color = s[o + P_LCOLOR + row];
      const col = wallCol(row, color);
      const pts = placementScore(wall, row, col);
      wall |= bit(row, col);
      score += pts;
      s[BOX + color] += row;
      s[o + P_LCOUNT + row] = 0;
      s[o + P_LCOLOR + row] = -1;
      pr?.placements.push({ row, col, color, points: pts });
    }
    const len = s[o + P_FLOOR_LEN];
    const pen = floorPenalty(len);
    score += pen;
    for (let i = 0; i < len; i++) {
      const t = s[o + P_FLOOR + i];
      if (t !== FIRST_TOKEN) s[BOX + t]++;
      s[o + P_FLOOR + i] = 0;
    }
    s[o + P_FLOOR_LEN] = 0;
    if (score < 0) score = 0;
    s[o + P_SCORE] = score;
    s[o + P_WALL] = wall;
    if (completedRows(wall) > 0) anyRow = true;
    if (pr) {
      pr.floorPenalty = pen;
      pr.scoreAfter = score;
      report!.players.push(pr);
    }
  }
  if (s[NEXT_FIRST] >= 0) s[STARTER] = s[NEXT_FIRST];
  s[NEXT_FIRST] = -1;
  s[CUR] = s[STARTER];
  if (anyRow) {
    for (let p = 0; p < 2; p++) {
      const o = pOff(p);
      const b = endGameBonus(s[o + P_WALL]);
      s[o + P_SCORE] += b.total;
      if (report) {
        report.players[p].bonus = b;
        report.players[p].scoreAfter = s[o + P_SCORE];
      }
    }
    s[OVER] = 1;
  }
  if (report) report.gameOver = anyRow;
}

/** 実ゲーム用: 手を指し、必要ならラウンド終了処理と次ラウンドの補充まで進める */
export function advance(s: State, m: Move): RoundReport | null {
  applyMove(s, m);
  if (!roundOver(s)) return null;
  const report: RoundReport = { players: [], gameOver: false };
  scoreRoundEnd(s, report);
  if (!s[OVER]) startRound(s);
  return report;
}

/** 勝者(0/1)、引き分けなら -1 */
export function winner(s: State): number {
  const a = s[pOff(0) + P_SCORE];
  const b = s[pOff(1) + P_SCORE];
  if (a !== b) return a > b ? 0 : 1;
  const ra = completedRows(s[pOff(0) + P_WALL]);
  const rb = completedRows(s[pOff(1) + P_WALL]);
  if (ra !== rb) return ra > rb ? 0 : 1;
  return -1;
}
