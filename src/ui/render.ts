import { canPlace, scoreRoundEnd } from '../engine/rules';
import { bit } from '../engine/scoring';
import {
  CENTER,
  COLOR_NAMES,
  CTR,
  CTR_FIRST,
  CUR,
  FACT,
  FIRST_TOKEN,
  FLOOR_DEST,
  FLOOR_SIZE,
  NUM_COLORS,
  NUM_FACTORIES,
  OVER,
  P_FLOOR,
  P_FLOOR_LEN,
  P_LCOLOR,
  P_LCOUNT,
  P_SCORE,
  P_WALL,
  pOff,
  wallColor,
  type State,
} from '../engine/state';

export interface Selection {
  src: number;
  color: number;
}

export interface ViewModel {
  state: State;
  human: number;
  selected: Selection | null;
  /** AI が取ろうとしているタイル(演出用) */
  aiPick: Selection | null;
  /** 直前の手の置き先(演出用) */
  lastDest: { player: number; dest: number } | null;
  /** ラウンド終了で新しく壁に置かれたマス(演出用) */
  newWall: { player: number; row: number; col: number }[];
  interactive: boolean;
}

export interface Handlers {
  onPick(src: number, color: number): void;
  onPlace(dest: number): void;
}

const PENALTY_LABELS = ['-1', '-1', '-2', '-2', '-2', '-3', '-3'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function tileEl(color: number, extra = ''): HTMLDivElement {
  const t = el('div', `tile c${color}${extra ? ' ' + extra : ''}`);
  t.setAttribute('aria-label', color === FIRST_TOKEN ? '先手マーカー' : COLOR_NAMES[color]);
  if (color === FIRST_TOKEN) t.textContent = '1';
  return t;
}

/** ラウンド終了時点で入る予定の点数(床の減点込み) */
export function projectedGain(s: State, p: number): number {
  const copy = s.slice();
  const before = copy[pOff(p) + P_SCORE];
  scoreRoundEnd(copy);
  return copy[pOff(p) + P_SCORE] - before;
}

export function renderMarket(root: HTMLElement, vm: ViewModel, h: Handlers): void {
  const s = vm.state;
  root.replaceChildren();
  const factories = el('div', 'factories');
  for (let f = 0; f < NUM_FACTORIES; f++) {
    const fac = el('div', 'factory');
    fac.setAttribute('aria-label', `工場${f + 1}`);
    const tiles: number[] = [];
    for (let c = 0; c < NUM_COLORS; c++) for (let i = 0; i < s[FACT + f * NUM_COLORS + c]; i++) tiles.push(c);
    if (tiles.length === 0) fac.classList.add('empty');
    for (const c of tiles) fac.append(sourceTile(vm, h, f, c));
    factories.append(fac);
  }
  const center = el('div', 'center');
  center.setAttribute('aria-label', '中央');
  if (s[CTR_FIRST]) center.append(tileEl(FIRST_TOKEN, 'token'));
  for (let c = 0; c < NUM_COLORS; c++) {
    const n = s[CTR + c];
    if (!n) continue;
    const group = el('div', 'center-group');
    for (let i = 0; i < n; i++) group.append(sourceTile(vm, h, CENTER, c));
    center.append(group);
  }
  if (center.childElementCount === 0) center.append(el('span', 'center-label', '中央'));
  root.append(factories, center);
}

function sourceTile(vm: ViewModel, h: Handlers, src: number, color: number): HTMLElement {
  const t = tileEl(color);
  const sel = vm.selected;
  const ai = vm.aiPick;
  if (sel && sel.src === src && sel.color === color) t.classList.add('selected');
  if (ai && ai.src === src && ai.color === color) t.classList.add('ai-pick');
  if (vm.interactive) {
    t.classList.add('clickable');
    t.tabIndex = 0;
    const pick = () => h.onPick(src, color);
    t.addEventListener('click', pick);
    t.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pick();
      }
    });
  }
  return t;
}

export function renderBoard(root: HTMLElement, vm: ViewModel, player: number, name: string, h: Handlers): void {
  const s = vm.state;
  const o = pOff(player);
  const wall = s[o + P_WALL];
  const isHuman = player === vm.human;
  const sel = isHuman && vm.interactive ? vm.selected : null;
  root.replaceChildren();
  root.classList.toggle('active', !s[OVER] && s[CUR] === player);

  const head = el('div', 'board-head');
  head.append(el('span', 'board-name', name));
  const score = el('span', 'board-score');
  score.append(el('b', '', String(s[o + P_SCORE])), document.createTextNode(' 点'));
  if (!s[OVER]) {
    const gain = projectedGain(s, player);
    const g = el('span', `gain ${gain >= 0 ? 'pos' : 'neg'}`, `${gain >= 0 ? '+' : ''}${gain}`);
    g.title = 'このラウンド終了時の予想得点';
    score.append(g);
  }
  head.append(score);
  root.append(head);

  const body = el('div', 'board-body');
  const lines = el('div', 'lines');
  for (let row = 0; row < 5; row++) {
    const line = el('div', 'line');
    const cnt = s[o + P_LCOUNT + row];
    const color = s[o + P_LCOLOR + row];
    for (let i = row; i >= 0; i--) {
      const slot = el('div', 'slot');
      // 右詰めで埋まる: 右端から cnt 枚
      if (i < cnt) slot.append(tileEl(color));
      line.append(slot);
    }
    if (vm.lastDest && vm.lastDest.player === player && vm.lastDest.dest === row) line.classList.add('flash');
    if (sel) {
      if (canPlace(s, player, sel.color, row)) {
        line.classList.add('target');
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        line.setAttribute('aria-label', `${row + 1}段目に置く`);
        line.addEventListener('click', () => h.onPlace(row));
        line.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            h.onPlace(row);
          }
        });
      } else {
        line.classList.add('blocked');
      }
    }
    lines.append(line);
  }

  const wallEl = el('div', 'wall');
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const c = wallColor(row, col);
      const cell = el('div', `cell c${c}`);
      if (wall & bit(row, col)) {
        const t = tileEl(c);
        if (vm.newWall.some((w) => w.player === player && w.row === row && w.col === col)) t.classList.add('placed');
        cell.append(t);
      } else if (sel && sel.color === c && canPlace(s, player, c, row)) {
        cell.classList.add('hint');
      }
      wallEl.append(cell);
    }
  }
  body.append(lines, wallEl);
  root.append(body);

  const floor = el('div', 'floor');
  const len = s[o + P_FLOOR_LEN];
  for (let i = 0; i < FLOOR_SIZE; i++) {
    const slot = el('div', 'fslot');
    slot.append(el('span', 'pen', PENALTY_LABELS[i]));
    if (i < len) slot.append(tileEl(s[o + P_FLOOR + i]));
    floor.append(slot);
  }
  if (vm.lastDest && vm.lastDest.player === player && vm.lastDest.dest === FLOOR_DEST) floor.classList.add('flash');
  if (sel) {
    floor.classList.add('target');
    floor.tabIndex = 0;
    floor.setAttribute('role', 'button');
    floor.setAttribute('aria-label', '床に置く');
    floor.addEventListener('click', () => h.onPlace(FLOOR_DEST));
    floor.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        h.onPlace(FLOOR_DEST);
      }
    });
  }
  root.append(floor);
}
