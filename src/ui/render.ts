import { canPlace, scoreRoundEnd } from '../engine/rules';
import { bit } from '../engine/scoring';
import {
  CENTER,
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
import { getCopy, type Locale } from './i18n';

export interface Selection {
  src: number;
  color: number;
}

/** 盤面上で強調表示する 1 手(取得元のタイルと置き先) */
export interface MoveMark extends Selection {
  player: number;
  dest: number;
}

export interface ViewModel {
  state: State;
  locale: Locale;
  human: number;
  /** プレイヤーごとの表示名 */
  names: readonly string[];
  /** 名前の横に出す補足(AI の強さなど) */
  tags: readonly string[];
  selected: Selection | null;
  /** 相手がこれから指す手 / リプレイで次に指される手 */
  pending: MoveMark | null;
  /** リプレイで AI が推奨する手 */
  suggestion: MoveMark | null;
  /** 直前の相手の手の置き先(次に自分が指すまで残す) */
  lastDest: { player: number; dest: number } | null;
  /** 工場にタイルが補充されてからの経過時間(ms)。配る演出中でなければ null */
  dealt: number | null;
  interactive: boolean;
  showGain: boolean;
}

export interface Handlers {
  onPick(src: number, color: number): void;
  onPlace(dest: number): void;
}

const PENALTY_LABELS = ['-1', '-1', '-2', '-2', '-2', '-3', '-3'];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function tileEl(color: number, locale: Locale, extra = ''): HTMLDivElement {
  const t = el('div', `tile c${color}${extra ? ' ' + extra : ''}`);
  const copy = getCopy(locale);
  t.setAttribute('aria-label', color === FIRST_TOKEN ? copy.firstPlayerMarker : copy.colors[color]);
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

function onActivate(target: HTMLElement, fn: () => void): void {
  target.addEventListener('click', fn);
  target.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fn();
    }
  });
}

const sameSource = (m: Selection | null, src: number, color: number): boolean => !!m && m.src === src && m.color === color;

export function renderMarket(root: HTMLElement, vm: ViewModel, h: Handlers): void {
  const s = vm.state;
  const copy = getCopy(vm.locale);
  root.replaceChildren();
  const ring = el('div', 'ring');
  let dealIndex = 0;
  for (let f = 0; f < NUM_FACTORIES; f++) {
    const fac = el('div', 'factory source');
    fac.style.setProperty('--i', String(f));
    fac.dataset.factory = String(f);
    fac.setAttribute('aria-label', copy.factory(f + 1));
    fac.setAttribute('role', 'group');
    const tiles: number[] = [];
    for (let c = 0; c < NUM_COLORS; c++) for (let i = 0; i < s[FACT + f * NUM_COLORS + c]; i++) tiles.push(c);
    if (tiles.length === 0) fac.classList.add('empty');
    for (const c of tiles) {
      const t = sourceTile(vm, h, f, c);
      if (vm.dealt !== null) {
        // 描き直しても演出が最初からやり直しにならないよう、経過時間ぶん遅延を前倒しする
        t.classList.add('deal');
        t.style.animationDelay = `calc(var(--speed, 1) * ${dealIndex++ * 35}ms - ${Math.round(vm.dealt)}ms)`;
      }
      fac.append(t);
    }
    ring.append(fac);
  }
  const center = el('div', 'center source');
  center.dataset.center = '';
  center.setAttribute('aria-label', copy.center);
  center.setAttribute('role', 'group');
  if (s[CTR_FIRST]) {
    const token = tileEl(FIRST_TOKEN, vm.locale, 'token');
    token.dataset.token = '';
    token.title = copy.firstPlayerMarker;
    center.append(token);
  }
  for (let c = 0; c < NUM_COLORS; c++) {
    const n = s[CTR + c];
    if (!n) continue;
    const group = el('div', 'center-group');
    group.dataset.color = String(c);
    for (let i = 0; i < n; i++) {
      const t = sourceTile(vm, h, CENTER, c);
      t.dataset.i = String(i);
      group.append(t);
    }
    if (n > 1) group.append(el('span', 'count', `×${n}`));
    center.append(group);
  }
  if (center.childElementCount === 0) center.append(el('span', 'center-label', copy.center));
  ring.append(center);
  root.append(ring);
}

function sourceTile(vm: ViewModel, h: Handlers, src: number, color: number): HTMLElement {
  const t = tileEl(color, vm.locale);
  t.dataset.src = String(src);
  t.dataset.color = String(color);
  if (sameSource(vm.selected, src, color)) t.classList.add('selected');
  if (sameSource(vm.pending, src, color)) t.classList.add('picked');
  if (sameSource(vm.suggestion, src, color)) t.classList.add('suggested');
  if (vm.interactive) {
    t.classList.add('clickable');
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    onActivate(t, () => h.onPick(src, color));
  }
  return t;
}

export function renderBoard(root: HTMLElement, vm: ViewModel, player: number, h: Handlers): void {
  const s = vm.state;
  const copy = getCopy(vm.locale);
  const o = pOff(player);
  const wall = s[o + P_WALL];
  const isHuman = player === vm.human;
  const sel = isHuman && vm.interactive ? vm.selected : null;
  const marks = (m: MoveMark | null, dest: number): boolean => !!m && m.player === player && m.dest === dest;
  root.replaceChildren();
  root.dataset.player = String(player);
  root.classList.toggle('active', !s[OVER] && s[CUR] === player);

  const head = el('div', 'board-head');
  const who = el('div', 'who');
  who.append(el('span', 'turn-dot'), el('span', 'board-name', vm.names[player]));
  if (vm.tags[player]) who.append(el('span', 'tag', vm.tags[player]));
  head.append(who);
  const score = el('div', 'board-score');
  if (vm.showGain && !s[OVER]) {
    const gain = projectedGain(s, player);
    const g = el('span', `gain ${gain >= 0 ? 'pos' : 'neg'}`, `${gain >= 0 ? '+' : ''}${gain}`);
    g.title = copy.projectedGain;
    score.append(g);
  }
  const value = el('b', '', String(s[o + P_SCORE]));
  value.dataset.score = '';
  score.append(value, el('span', 'unit', copy.points));
  head.append(score);
  root.append(head);

  const body = el('div', 'board-body');
  const lines = el('div', 'lines');
  for (let row = 0; row < 5; row++) {
    const line = el('div', 'line');
    line.dataset.row = String(row);
    const cnt = s[o + P_LCOUNT + row];
    const color = s[o + P_LCOLOR + row];
    for (let i = row; i >= 0; i--) {
      const slot = el('div', 'slot');
      slot.dataset.i = String(i);
      // 右詰めで埋まる: 右端から cnt 枚
      if (i < cnt) slot.append(tileEl(color, vm.locale));
      line.append(slot);
    }
    if (cnt === row + 1) line.classList.add('full');
    if (vm.lastDest && vm.lastDest.player === player && vm.lastDest.dest === row) line.classList.add('last');
    if (marks(vm.pending, row)) line.classList.add('marked');
    if (marks(vm.suggestion, row)) line.classList.add('suggested');
    if (sel) {
      if (canPlace(s, player, sel.color, row)) {
        line.classList.add('target');
        line.tabIndex = 0;
        line.setAttribute('role', 'button');
        line.setAttribute('aria-label', copy.placeRow(row + 1));
        onActivate(line, () => h.onPlace(row));
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
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      if (wall & bit(row, col)) {
        cell.append(tileEl(c, vm.locale));
      } else {
        cell.append(el('div', `tile ghost c${c}`));
        if (sel && sel.color === c && canPlace(s, player, c, row)) cell.classList.add('hint');
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
    slot.dataset.i = String(i);
    slot.append(el('span', 'pen', PENALTY_LABELS[i]));
    if (i < len) slot.append(tileEl(s[o + P_FLOOR + i], vm.locale));
    floor.append(slot);
  }
  if (vm.lastDest && vm.lastDest.player === player && vm.lastDest.dest === FLOOR_DEST) floor.classList.add('last');
  if (marks(vm.pending, FLOOR_DEST)) floor.classList.add('marked');
  if (marks(vm.suggestion, FLOOR_DEST)) floor.classList.add('suggested');
  if (sel) {
    floor.classList.add('target');
    floor.tabIndex = 0;
    floor.setAttribute('role', 'button');
    floor.setAttribute('aria-label', copy.placeFloor);
    onActivate(floor, () => h.onPlace(FLOOR_DEST));
  }
  root.append(floor);
}
