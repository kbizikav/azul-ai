/// <reference lib="webworker" />
import { applyMove, roundOver } from '../engine/rules';
import { CUR, STATE_SIZE, type State } from '../engine/state';
import { DEFAULT_WEIGHTS, evaluate } from './evaluate';
import { Searcher, greedyMove } from './search';

export type Level = 'easy' | 'normal' | 'hard' | 'max';

export interface AiRequest {
  id: number;
  state: Int32Array;
  level: Level;
  /** 指定時は対局後の解析用: 難易度を無視してこの時間だけ探索し、必ず評価値を返す */
  analysisMs?: number;
}

export interface AiResponse {
  id: number;
  move: number;
  score: number | null;
  depth: number;
  nodes: number;
  solved: boolean;
  timeMs: number;
}

const LEVELS: Record<Exclude<Level, 'easy'>, { timeMs: number; maxDepth?: number }> = {
  normal: { timeMs: 300, maxDepth: 2 },
  hard: { timeMs: 1000 },
  max: { timeMs: 4000 },
};

const searcher = new Searcher();
const scratch: State = new Int32Array(STATE_SIZE);

/** 手番側視点の評価値。合法手が 1 つだけだと探索が評価値を返さないので、その手を指した局面を評価し直す */
function analyze(state: State, timeMs: number): Omit<AiResponse, 'id'> {
  const r = searcher.search(state, { timeMs });
  if (r.depth > 0) return r;
  const child = state.slice();
  applyMove(child, r.move);
  const score = roundOver(child)
    ? evaluate(child, state[CUR], scratch, DEFAULT_WEIGHTS, true)
    : (child[CUR] === state[CUR] ? 1 : -1) * (analyze(child, timeMs).score ?? 0);
  return { ...r, score };
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, state, level, analysisMs } = e.data;
  let res: AiResponse;
  if (analysisMs !== undefined) {
    res = { id, ...analyze(state, analysisMs) };
  } else if (level === 'easy') {
    res = { id, move: greedyMove(state, 3), score: null, depth: 1, nodes: 0, solved: false, timeMs: 0 };
  } else {
    const r = searcher.search(state, LEVELS[level]);
    res = { id, ...r };
  }
  (self as unknown as Worker).postMessage(res);
};
