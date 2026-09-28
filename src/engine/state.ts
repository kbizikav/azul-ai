// ゲーム状態はすべて 1 本の Int32Array に詰めている。
// AI 探索ではノードごとに `child.set(parent)` でコピーするだけで済むため高速。

export const NUM_COLORS = 5;
export const NUM_FACTORIES = 5; // 2人用
export const TILES_PER_COLOR = 20;
export const TILES_PER_FACTORY = 4;
export const FLOOR_SIZE = 7;
export const FIRST_TOKEN = 5; // 床に置かれた先手マーカー
export const CENTER = NUM_FACTORIES; // 取得元インデックス: 0..4 = 工場, 5 = 中央
export const FLOOR_DEST = 5; // 置き先インデックス: 0..4 = パターンライン, 5 = 床

// --- レイアウト ---
export const FACT = 0; // 工場 [f*5 + color] = 枚数
export const CTR = FACT + NUM_FACTORIES * NUM_COLORS; // 中央 [color] = 枚数
export const CTR_FIRST = CTR + NUM_COLORS; // 中央に先手マーカーがあるか
export const BAG = CTR_FIRST + 1; // 袋 [color]
export const BOX = BAG + NUM_COLORS; // 箱(捨て場) [color]
export const CUR = BOX + NUM_COLORS; // 手番プレイヤー
export const NEXT_FIRST = CUR + 1; // 今ラウンド先手マーカーを取ったプレイヤー(-1 = まだ)
export const STARTER = NEXT_FIRST + 1; // 今ラウンドの先手
export const ROUND = STARTER + 1; // ラウンド番号(1始まり)
export const OVER = ROUND + 1; // ゲーム終了フラグ
export const RNG = OVER + 1; // 乱数状態(Undo しても同じ補充になるよう状態に含める)
export const P_BASE = RNG + 1;

// プレイヤーブロック内オフセット
export const P_SCORE = 0;
export const P_WALL = 1; // 25bit マスク(bit = row*5 + col)
export const P_LCOLOR = 2; // パターンラインの色 [row](-1 = 空)
export const P_LCOUNT = P_LCOLOR + 5; // パターンラインの枚数 [row]
export const P_FLOOR_LEN = P_LCOUNT + 5;
export const P_FLOOR = P_FLOOR_LEN + 1; // 床のタイル [i](色 or FIRST_TOKEN)
export const P_SIZE = P_FLOOR + FLOOR_SIZE;

export const STATE_SIZE = P_BASE + P_SIZE * 2;

export type State = Int32Array;

export const pOff = (p: number): number => P_BASE + p * P_SIZE;

/** 壁の (row, color) が置かれる列 */
export const wallCol = (row: number, color: number): number => (color + row) % 5;
/** 壁の (row, col) の色 */
export const wallColor = (row: number, col: number): number => (col - row + 5) % 5;

export const FLOOR_PENALTY = [0, -1, -2, -4, -6, -8, -11, -14]; // 床の枚数 → 累計減点

export function cloneState(s: State): State {
  return s.slice();
}

// --- 手のエンコード: src*30 + color*6 + dest ---
export type Move = number;
export const encodeMove = (src: number, color: number, dest: number): Move => src * 30 + color * 6 + dest;
export const moveSrc = (m: Move): number => (m / 30) | 0;
export const moveColor = (m: Move): number => ((m % 30) / 6) | 0;
export const moveDest = (m: Move): number => m % 6;
export const MAX_MOVE = 6 * 30;
