import { FLOOR_PENALTY, wallCol } from './state';

export const ROW_BONUS = 2;
export const COL_BONUS = 7;
export const COLOR_BONUS = 10;

export const bit = (row: number, col: number): number => 1 << (row * 5 + col);
export const ROW_MASK = [0, 1, 2, 3, 4].map((r) => 0x1f << (r * 5));
export const COL_MASK = [0, 1, 2, 3, 4].map((c) => {
  let m = 0;
  for (let r = 0; r < 5; r++) m |= bit(r, c);
  return m;
});
export const COLOR_MASK = [0, 1, 2, 3, 4].map((k) => {
  let m = 0;
  for (let r = 0; r < 5; r++) m |= bit(r, wallCol(r, k));
  return m;
});

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

/** RUN[bits5 * 5 + pos]: 5bit 列 bits5 の pos を含む連続長(pos 自身は置いたものとみなす) */
export const RUN: Uint8Array = (() => {
  const t = new Uint8Array(32 * 5);
  for (let m = 0; m < 32; m++) {
    for (let p = 0; p < 5; p++) {
      let n = 1;
      for (let q = p - 1; q >= 0 && (m >> q) & 1; q--) n++;
      for (let q = p + 1; q < 5 && (m >> q) & 1; q++) n++;
      t[m * 5 + p] = n;
    }
  }
  return t;
})();

export const rowBits = (wall: number, row: number): number => (wall >>> (row * 5)) & 31;

export function colBits(wall: number, col: number): number {
  const w = wall >>> col;
  return (w & 1) | ((w >>> 4) & 2) | ((w >>> 8) & 4) | ((w >>> 12) & 8) | ((w >>> 16) & 16);
}

/** 横 h・縦 v の連続長からの得点 */
export const runScore = (h: number, v: number): number => (h > 1 ? h : 0) + (v > 1 ? v : 0) || 1;

/** wall に (row, col) を置いたときの得点(wall には未配置の前提) */
export function placementScore(wall: number, row: number, col: number): number {
  return runScore(RUN[rowBits(wall, row) * 5 + col], RUN[colBits(wall, col) * 5 + row]);
}

const PENALTY_TABLE = Int32Array.from({ length: 64 }, (_, i) => FLOOR_PENALTY[i > 7 ? 7 : i]);

export function floorPenalty(len: number): number {
  return PENALTY_TABLE[len];
}

export function completedRows(wall: number): number {
  let n = 0;
  for (let r = 0; r < 5; r++) if ((wall & ROW_MASK[r]) === ROW_MASK[r]) n++;
  return n;
}

export interface Bonus {
  rows: number;
  cols: number;
  colors: number;
  total: number;
}

export function endGameBonus(wall: number): Bonus {
  let rows = 0;
  let cols = 0;
  let colors = 0;
  for (let i = 0; i < 5; i++) {
    if ((wall & ROW_MASK[i]) === ROW_MASK[i]) rows++;
    if ((wall & COL_MASK[i]) === COL_MASK[i]) cols++;
    if ((wall & COLOR_MASK[i]) === COLOR_MASK[i]) colors++;
  }
  return { rows, cols, colors, total: rows * ROW_BONUS + cols * COL_BONUS + colors * COLOR_BONUS };
}
