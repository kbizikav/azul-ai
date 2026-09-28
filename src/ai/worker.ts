/// <reference lib="webworker" />
import { Searcher, greedyMove } from './search';

export type Level = 'easy' | 'normal' | 'hard' | 'max';

export interface AiRequest {
  id: number;
  state: Int32Array;
  level: Level;
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

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, state, level } = e.data;
  let res: AiResponse;
  if (level === 'easy') {
    res = { id, move: greedyMove(state, 3), score: null, depth: 1, nodes: 0, solved: false, timeMs: 0 };
  } else {
    const r = searcher.search(state, LEVELS[level]);
    res = { id, ...r };
  }
  (self as unknown as Worker).postMessage(res);
};
