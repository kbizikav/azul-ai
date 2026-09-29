import type { RoundReport } from '../engine/rules';
import { COLOR_MASK, COL_MASK, ROW_MASK, bit } from '../engine/scoring';
import {
  CENTER,
  CTR,
  CTR_FIRST,
  CUR,
  FIRST_TOKEN,
  FLOOR_DEST,
  NUM_COLORS,
  P_FLOOR_LEN,
  P_LCOLOR,
  P_LCOUNT,
  P_SCORE,
  P_WALL,
  moveColor,
  moveDest,
  moveSrc,
  pOff,
  wallCol,
  type Move,
  type State,
} from '../engine/state';
import type { Locale } from './i18n';
import { el, tileEl } from './render';

export type AnimSpeed = 'normal' | 'fast' | 'off';

const SPEED_FACTOR: Record<AnimSpeed, number> = { normal: 1, fast: 0.5, off: 0 };

interface Flight {
  color: number;
  from: DOMRect;
  /** 着地先の要素。null なら床の外(箱)へ消える */
  to: HTMLElement | null;
  fallback?: DOMRect;
}

/**
 * 盤面の上に重ねた演出レイヤー。タイルの移動や得点表示をここで行い、
 * 盤面そのものは状態から描き直す(演出中に描き直しても演出は壊れない)。
 */
export class Stage {
  private factor = 1;
  private readonly layer: HTMLElement;
  private readonly running = new Set<Animation>();
  private readonly sleepers = new Set<() => void>();

  constructor(
    private readonly dom: { market: HTMLElement; boards: readonly HTMLElement[] },
    private readonly locale: () => Locale,
  ) {
    this.layer = el('div', 'fx-layer');
    this.layer.setAttribute('aria-hidden', 'true');
    document.body.append(this.layer);
  }

  setSpeed(speed: AnimSpeed): void {
    this.factor = SPEED_FACTOR[speed];
    document.documentElement.style.setProperty('--speed', String(this.factor || 0.001));
    document.documentElement.classList.toggle('no-anim', this.factor === 0);
  }

  /** 演出を行うか(jsdom や「動きを減らす」設定では行わない) */
  get enabled(): boolean {
    if (this.factor === 0 || typeof Element.prototype.animate !== 'function') return false;
    return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /** 進行中の演出をすべて打ち切る(待機中の sleep も即座に解決する) */
  cancel(): void {
    for (const a of this.running) a.cancel();
    this.running.clear();
    for (const wake of this.sleepers) wake();
    this.sleepers.clear();
    this.layer.replaceChildren();
  }

  sleep(ms: number): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms * this.factor);
      this.sleepers.add(wake);
    });
  }

  private play(target: Element, frames: Keyframe[], ms: number, opts: KeyframeAnimationOptions = {}): Promise<void> {
    const a = target.animate(frames, { duration: ms * this.factor, fill: 'forwards', easing: 'ease', ...opts });
    this.running.add(a);
    return a.finished.then(
      () => void this.running.delete(a),
      () => void this.running.delete(a),
    );
  }

  private board(player: number): HTMLElement {
    return this.dom.boards[player];
  }

  // ---------------- 手の移動 ----------------

  /**
   * before から move を指した結果を描画しつつ、取ったタイルが置き先へ飛ぶ演出をする。
   * render は move 適用後の状態を描画する関数。
   */
  async animateMove(before: State, move: Move, render: () => void): Promise<void> {
    if (!this.enabled) {
      render();
      return;
    }
    const src = moveSrc(move);
    const color = moveColor(move);
    const dest = moveDest(move);
    const player = before[CUR];
    const o = pOff(player);
    const market = this.dom.market;
    const rect = (e: Element): DOMRect => e.getBoundingClientRect();

    const picked = [...market.querySelectorAll(`.tile[data-src="${src}"][data-color="${color}"]`)].map(rect);
    const rest =
      src < CENTER
        ? [...market.querySelectorAll<HTMLElement>(`.factory[data-factory="${src}"] .tile`)]
            .filter((t) => t.dataset.color !== String(color))
            .map((t) => ({ color: Number(t.dataset.color), from: rect(t) }))
        : [];
    const tokenEl = src === CENTER && before[CTR_FIRST] ? market.querySelector('[data-token]') : null;
    const token = tokenEl ? rect(tokenEl) : null;
    const lineCount = dest < FLOOR_DEST ? before[o + P_LCOUNT + dest] : 0;
    const floorLen = before[o + P_FLOOR_LEN];
    const centerCounts = Array.from({ length: NUM_COLORS }, (_, c) => before[CTR + c]);

    render();

    const board = this.board(player);
    const lineTiles: HTMLElement[] = [];
    if (dest < FLOOR_DEST) {
      for (let i = lineCount; i <= dest; i++) {
        const t = board.querySelector<HTMLElement>(`.line[data-row="${dest}"] .slot[data-i="${i}"] .tile`);
        if (t) lineTiles.push(t);
      }
    }
    const floorTiles = [...board.querySelectorAll<HTMLElement>('.fslot .tile')].slice(floorLen);
    const floorEnd = board.querySelector('.floor');
    const flights: Flight[] = [];
    if (token) flights.push({ color: FIRST_TOKEN, from: token, to: floorTiles.shift() ?? null });
    for (const from of picked) {
      const to = lineTiles.shift() ?? floorTiles.shift() ?? null;
      flights.push({ color, from, to, fallback: floorEnd ? rect(floorEnd) : undefined });
    }
    const nextIndex = [...centerCounts];
    for (const r of rest) {
      const i = nextIndex[r.color]++;
      const to = market.querySelector<HTMLElement>(`.center-group[data-color="${r.color}"] .tile[data-i="${i}"]`);
      flights.push({ color: r.color, from: r.from, to });
    }
    await this.fly(flights, 560, 55);
  }

  private async fly(flights: Flight[], ms: number, stagger: number): Promise<void> {
    const landed: HTMLElement[] = [];
    const jobs = flights.map((f, k) => {
      const target = f.to?.getBoundingClientRect() ?? f.fallback;
      if (!target) return Promise.resolve();
      if (f.to) {
        f.to.style.visibility = 'hidden';
        landed.push(f.to);
      }
      const clone = tileEl(f.color, this.locale(), 'fx-tile');
      Object.assign(clone.style, {
        left: `${f.from.left}px`,
        top: `${f.from.top}px`,
        width: `${f.from.width}px`,
        height: `${f.from.height}px`,
        fontSize: `${f.from.width * 0.55}px`,
      });
      this.layer.append(clone);
      const dx = target.left - f.from.left + (f.to ? 0 : target.width - f.from.width);
      const dy = target.top - f.from.top;
      const k2 = f.to ? target.width / f.from.width : 0.6;
      const lift = Math.min(60, 20 + Math.hypot(dx, dy) * 0.12);
      const frames: Keyframe[] = [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx / 2}px, ${dy / 2 - lift}px) scale(${((1 + k2) / 2) * 1.12})`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k2})`, opacity: f.to ? 1 : 0 },
      ];
      return this.play(clone, frames, ms, { delay: k * stagger * this.factor, easing: 'cubic-bezier(.45,.05,.3,1)' }).then(() => {
        if (f.to) f.to.style.visibility = '';
        clone.remove();
      });
    });
    await Promise.all(jobs);
    for (const t of landed) t.style.visibility = '';
  }

  // ---------------- 得点計算 ----------------

  /**
   * ラウンド終了の得点計算を 1 段ずつ見せる。show は途中経過の状態を描画する関数。
   * pre はラウンド最後の手を指した直後(得点計算前)の状態。
   */
  async animateScoring(pre: State, report: RoundReport, show: (s: State) => void): Promise<void> {
    if (!this.enabled) return;
    const s = pre.slice();
    show(s);
    await this.sleep(350);

    for (let row = 0; row < 5; row++) {
      const items = report.players.flatMap((pr, player) => pr.placements.filter((pl) => pl.row === row).map((pl) => ({ player, pl })));
      if (items.length === 0) continue;
      const flights: Flight[] = [];
      const fades: Promise<void>[] = [];
      for (const { player, pl } of items) {
        const board = this.board(player);
        const line = board.querySelector(`.line[data-row="${row}"]`);
        const first = line?.querySelector('.slot[data-i="0"] .tile');
        const cell = board.querySelector<HTMLElement>(`.cell[data-row="${row}"][data-col="${pl.col}"]`);
        if (!line || !first || !cell) continue;
        (first as HTMLElement).style.visibility = 'hidden';
        flights.push({ color: pl.color, from: first.getBoundingClientRect(), to: cell });
        for (const t of line.querySelectorAll('.slot:not([data-i="0"]) .tile')) {
          fades.push(this.play(t, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px) scale(.8)' }], 380));
        }
      }
      await Promise.all([this.fly(flights, 480, 0), ...fades]);
      for (const { player, pl } of items) {
        const o = pOff(player);
        s[o + P_WALL] |= bit(row, pl.col);
        s[o + P_LCOUNT + row] = 0;
        s[o + P_LCOLOR + row] = -1;
        s[o + P_SCORE] += pl.points;
      }
      show(s);
      for (const { player, pl } of items) {
        const cells = runCells(s[pOff(player) + P_WALL], row, pl.col);
        this.pulse(player, cells);
        this.floatText(this.cellRect(player, row, pl.col), `+${pl.points}`, 'plus');
        this.bump(player);
      }
      await this.sleep(750);
    }

    const floors = report.players.map((pr, player) => ({ player, pr })).filter(({ player }) => s[pOff(player) + P_FLOOR_LEN] > 0);
    if (floors.length) {
      const fades: Promise<void>[] = [];
      for (const { player, pr } of floors) {
        const floor = this.board(player).querySelector('.floor');
        if (!floor) continue;
        if (pr.floorPenalty) this.floatText(floor.getBoundingClientRect(), String(pr.floorPenalty), 'minus');
        for (const t of floor.querySelectorAll('.tile')) {
          fades.push(this.play(t, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(10px) rotate(8deg)' }], 520, { delay: 250 * this.factor }));
        }
      }
      await Promise.all(fades);
      for (const { player, pr } of floors) {
        const o = pOff(player);
        s[o + P_FLOOR_LEN] = 0;
        s[o + P_SCORE] = Math.max(0, s[o + P_SCORE] + pr.floorPenalty);
      }
      show(s);
      for (const { player, pr } of floors) if (pr.floorPenalty) this.bump(player);
      await this.sleep(550);
    }

    if (!report.gameOver) return;
    const bonuses = report.players.map((_, player) => bonusSteps(s[pOff(player) + P_WALL]));
    const steps = Math.max(...bonuses.map((b) => b.length));
    for (let i = 0; i < steps; i++) {
      for (let player = 0; player < bonuses.length; player++) {
        const b = bonuses[player][i];
        if (!b) continue;
        s[pOff(player) + P_SCORE] += b.points;
      }
      show(s);
      for (let player = 0; player < bonuses.length; player++) {
        const b = bonuses[player][i];
        if (!b) continue;
        this.pulse(player, b.cells, 'bonus');
        const [row, col] = b.cells[b.cells.length - 1];
        this.floatText(this.cellRect(player, row, col), `+${b.points}`, 'bonus');
        this.bump(player);
      }
      await this.sleep(900);
    }
  }

  private cellRect(player: number, row: number, col: number): DOMRect | null {
    return this.board(player).querySelector(`.cell[data-row="${row}"][data-col="${col}"]`)?.getBoundingClientRect() ?? null;
  }

  private pulse(player: number, cells: [number, number][], cls = 'scoring'): void {
    const board = this.board(player);
    cells.forEach(([row, col], k) => {
      const t = board.querySelector<HTMLElement>(`.cell[data-row="${row}"][data-col="${col}"] .tile`);
      if (!t) return;
      t.classList.add(cls);
      t.style.animationDelay = `${k * 60 * this.factor}ms`;
    });
  }

  private bump(player: number): void {
    this.board(player).querySelector('[data-score]')?.classList.add('bump');
  }

  /** 盤面の上に「+3」などを浮かび上がらせる(待たない) */
  floatText(at: DOMRect | null, text: string, cls: string): void {
    if (!at || !this.enabled) return;
    const f = el('div', `fx-float ${cls}`, text);
    f.style.left = `${at.left + at.width / 2}px`;
    f.style.top = `${at.top + at.height / 2}px`;
    this.layer.append(f);
    void this.play(
      f,
      [
        { transform: 'translate(-50%, -30%) scale(.6)', opacity: 0 },
        { transform: 'translate(-50%, -90%) scale(1.15)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -110%) scale(1)', opacity: 1, offset: 0.75 },
        { transform: 'translate(-50%, -170%) scale(.95)', opacity: 0 },
      ],
      1300,
      { easing: 'ease-out' },
    ).then(() => f.remove());
  }

  /** 工場の上に「ラウンド 3」などの見出しを一瞬出す */
  async banner(text: string): Promise<void> {
    if (!this.enabled) return;
    const at = this.dom.market.getBoundingClientRect();
    const b = el('div', 'fx-banner', text);
    b.style.left = `${at.left + at.width / 2}px`;
    b.style.top = `${at.top + at.height / 2}px`;
    this.layer.append(b);
    await this.play(
      b,
      [
        { transform: 'translate(-50%, -50%) scale(.85)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.2 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.8 },
        { transform: 'translate(-50%, -50%) scale(1.05)', opacity: 0 },
      ],
      1100,
    );
    b.remove();
  }
}

/** (row, col) に置いたタイルの得点に数えられたマス */
export function runCells(wall: number, row: number, col: number): [number, number][] {
  const has = (r: number, c: number): boolean => r >= 0 && r < 5 && c >= 0 && c < 5 && (wall & bit(r, c)) !== 0;
  const cells: [number, number][] = [[row, col]];
  const horiz: [number, number][] = [];
  const vert: [number, number][] = [];
  for (let c = col - 1; has(row, c); c--) horiz.push([row, c]);
  for (let c = col + 1; has(row, c); c++) horiz.push([row, c]);
  for (let r = row - 1; has(r, col); r--) vert.push([r, col]);
  for (let r = row + 1; has(r, col); r++) vert.push([r, col]);
  return cells.concat(horiz, vert);
}

/** 終了ボーナスを 1 つずつ(横列 +2 → 縦列 +7 → 色 +10) */
export function bonusSteps(wall: number): { points: number; cells: [number, number][] }[] {
  const steps: { points: number; cells: [number, number][] }[] = [];
  const cellsOf = (mask: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) if (mask & bit(r, c)) out.push([r, c]);
    return out;
  };
  for (let i = 0; i < 5; i++) if ((wall & ROW_MASK[i]) === ROW_MASK[i]) steps.push({ points: 2, cells: cellsOf(ROW_MASK[i]) });
  for (let i = 0; i < 5; i++) if ((wall & COL_MASK[i]) === COL_MASK[i]) steps.push({ points: 7, cells: cellsOf(COL_MASK[i]) });
  for (let k = 0; k < 5; k++) {
    if ((wall & COLOR_MASK[k]) !== COLOR_MASK[k]) continue;
    steps.push({ points: 10, cells: [0, 1, 2, 3, 4].map((r): [number, number] => [r, wallCol(r, k)]) });
  }
  return steps;
}
