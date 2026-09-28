// AI 同士の自己対戦ベンチマーク。
//   npx tsx scripts/selfplay.ts --a search:200 --b greedy --games 40
// プレイヤー指定: greedy | search:<ms> | search:<ms>:<重み JSON ファイル>
import { readFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS, type Weights } from '../src/ai/evaluate';
import { Searcher, greedyMove } from '../src/ai/search';
import { advance, newGame, winner } from '../src/engine/rules';
import { CUR, OVER, P_SCORE, ROUND, pOff, type Move, type State } from '../src/engine/state';

interface Agent {
  name: string;
  pick(s: State): Move;
  stats: { nodes: number; depth: number; moves: number; solved: number; time: number };
}

function makeAgent(spec: string): Agent {
  const stats = { nodes: 0, depth: 0, moves: 0, solved: 0, time: 0 };
  if (spec === 'greedy') {
    return { name: spec, stats, pick: (s) => greedyMove(s) };
  }
  const [kind, ms, weightsFile] = spec.split(':');
  if (kind !== 'search') throw new Error(`unknown agent: ${spec}`);
  const weights: Weights = weightsFile
    ? { ...DEFAULT_WEIGHTS, ...JSON.parse(readFileSync(weightsFile, 'utf8')) }
    : DEFAULT_WEIGHTS;
  const searcher = new Searcher();
  return {
    name: spec,
    stats,
    pick(s) {
      const r = searcher.search(s, { timeMs: Number(ms), weights });
      stats.nodes += r.nodes;
      stats.depth += r.depth;
      stats.moves++;
      stats.time += r.timeMs;
      if (r.solved) stats.solved++;
      return r.move;
    },
  };
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const games = Number(arg('games', '20'));
const seed0 = Number(arg('seed', '1000'));
const A = makeAgent(arg('a', 'search:200'));
const B = makeAgent(arg('b', 'greedy'));

let winsA = 0;
let winsB = 0;
let draws = 0;
let sumA = 0;
let sumB = 0;
let rounds = 0;
for (let g = 0; g < games; g++) {
  // 同じシードで先後を入れ替えて 2 局ずつ
  const seed = seed0 + (g >> 1);
  const aSeat = g & 1;
  const s = newGame(seed, 0);
  const agents = aSeat === 0 ? [A, B] : [B, A];
  while (!s[OVER]) advance(s, agents[s[CUR]].pick(s));
  const w = winner(s);
  const sa = s[pOff(aSeat) + P_SCORE];
  const sb = s[pOff(1 - aSeat) + P_SCORE];
  sumA += sa;
  sumB += sb;
  rounds += s[ROUND];
  if (w === -1) draws++;
  else if (w === aSeat) winsA++;
  else winsB++;
  console.log(`game ${g + 1}: A(${aSeat === 0 ? '先' : '後'}) ${sa} - ${sb} B  rounds=${s[ROUND]}`);
}

const fmt = (a: Agent) =>
  a.stats.moves
    ? `avgDepth=${(a.stats.depth / a.stats.moves).toFixed(1)} solved=${((100 * a.stats.solved) / a.stats.moves).toFixed(0)}% ` +
      `nodes/s=${Math.round(a.stats.nodes / (a.stats.time / 1000))} avgTime=${(a.stats.time / a.stats.moves).toFixed(0)}ms`
    : '';
console.log('---');
console.log(`A=${A.name}  B=${B.name}  games=${games}`);
console.log(`A wins ${winsA}, B wins ${winsB}, draws ${draws}  (A win rate ${((100 * (winsA + draws / 2)) / games).toFixed(1)}%)`);
console.log(`avg score A=${(sumA / games).toFixed(1)} B=${(sumB / games).toFixed(1)}  avg rounds=${(rounds / games).toFixed(2)}`);
console.log(`A: ${fmt(A)}`);
console.log(`B: ${fmt(B)}`);
