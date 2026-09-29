import type { AiRequest, AiResponse, Level } from '../ai/worker';
import { applyMove, newGame, roundOver, sameFactory, scoreRoundEnd, startRound, winner, type RoundReport } from '../engine/rules';
import {
  CENTER,
  CUR,
  OVER,
  P_SCORE,
  ROUND,
  encodeMove,
  moveColor,
  moveDest,
  moveSrc,
  pOff,
  type Move,
  type State,
} from '../engine/state';
import { Stage, type AnimSpeed } from './animate';
import { renderEvalGraph } from './graph';
import { formatMove, formatMoveShort, getCopy, summarizeMove, type Copy, type Locale, type MoveSummary } from './i18n';
import { el, renderBoard, renderMarket, tileEl, type MoveMark, type Selection, type ViewModel } from './render';

const HUMAN = 0;
const AI = 1;

export type StartChoice = 'human' | 'ai' | 'random';

export interface Settings {
  level: Level;
  start: StartChoice;
  locale: Locale;
  anim: AnimSpeed;
  showGain: boolean;
}

export interface GameDom {
  aiBoard: HTMLElement;
  humanBoard: HTMLElement;
  market: HTMLElement;
  status: HTMLElement;
  log: HTMLElement;
  review: HTMLElement;
  modal: HTMLDialogElement;
  undo: HTMLButtonElement;
}

export interface Timing {
  /** AI が指すまでの最短時間 */
  aiMinMs: number;
  /** AI が取るタイルを見せてから動かすまでの時間 */
  aiPickMs: number;
  /** 対局後の解析で 1 局面あたりに使う探索時間 */
  analysisMs: number;
}

interface Analysis {
  /** あなた視点の評価値(点差) */
  value: number;
  /** 勝敗まで読み切っているか */
  decided: boolean;
  best: Move;
}

interface Ply {
  /** この手を指す前の局面 */
  state: State;
  move: Move;
  player: number;
  round: number;
  summary: MoveSummary;
  analysis?: Analysis;
}

interface RoundResult {
  /** このラウンドが終わった時点までの手数 */
  atPly: number;
  round: number;
  report: RoundReport;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 評価関数の勝敗ボーナス(読み切り 1000、仮の終局 250)を取り除いて点差に戻す */
function toPoints(v: number): { value: number; decided: boolean } {
  const a = Math.abs(v);
  if (a >= 900) return { value: v - Math.sign(v) * 1000, decided: true };
  if (a >= 200) return { value: v - Math.sign(v) * 250, decided: false };
  return { value: v, decided: false };
}

/** 中身が同じ工場から取る手は同じ手とみなす */
function sameMove(s: State, a: Move, b: Move): boolean {
  if (a === b) return true;
  if (moveColor(a) !== moveColor(b) || moveDest(a) !== moveDest(b)) return false;
  const sa = moveSrc(a);
  const sb = moveSrc(b);
  return sa < CENTER && sb < CENTER && sameFactory(s, sa, sb);
}

/** Web Worker 上の AI。古い依頼の結果は捨てる */
class AiClient {
  private readonly worker: Worker;
  private reqId = 0;
  private readonly pending = new Map<number, (r: AiResponse) => void>();

  constructor() {
    this.worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AiResponse>) => {
      const cb = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      cb?.(e.data);
    };
  }

  request(req: Omit<AiRequest, 'id'>): Promise<AiResponse | null> {
    const id = ++this.reqId;
    return new Promise((resolve) => {
      this.pending.set(id, (r) => resolve(id === this.reqId ? r : null));
      this.worker.postMessage({ ...req, id });
    });
  }

  /** 思考中の結果を無視する */
  discard(): void {
    this.reqId++;
  }
}

export class Game {
  private state!: State;
  private settings: Settings;
  private level: Level;
  private selected: Selection | null = null;
  private pendingMove: MoveMark | null = null;
  private lastDest: ViewModel['lastDest'] = null;
  private dealtAt = -Infinity;
  private phase: 'waiting' | 'idle' | 'thinking' | 'moving' | 'scoring' = 'idle';
  private plies: Ply[] = [];
  private rounds: RoundResult[] = [];
  private undoStack: number[] = [];
  private finalState: State | null = null;
  private token = 0; // 新規ゲーム/Undo/局面移動で進行中の非同期処理を無効化する
  private readonly ai = new AiClient();
  private readonly analyst = new AiClient();
  private analyzing = false;
  private readonly stage: Stage;
  // 振り返り
  private mode: 'play' | 'review' = 'play';
  private cursor = 0;
  private autoplay = false;
  private playRun = 0;
  /** 演出中の手(振り返りで 1 手進めている最中) */
  private stepping = -1;

  constructor(
    private readonly dom: GameDom,
    settings: Settings,
    private readonly timing: Timing = { aiMinMs: 500, aiPickMs: 550, analysisMs: 500 },
    private readonly hooks: { onNewGame?: () => void } = {},
  ) {
    this.settings = { ...settings };
    this.level = settings.level;
    this.stage = new Stage({ market: dom.market, boards: [dom.humanBoard, dom.aiBoard] }, () => this.settings.locale);
    this.stage.setSpeed(settings.anim);
    document.addEventListener('keydown', (e) => this.onKey(e));
    dom.undo.addEventListener('click', () => this.undo());
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => this.mode === 'review' && this.renderReviewPanel(), 120);
    });
  }

  setLocale(locale: Locale): void {
    this.settings.locale = locale;
    this.render();
  }

  setAnimation(anim: AnimSpeed): void {
    this.settings.anim = anim;
    this.stage.setSpeed(anim);
  }

  setShowGain(show: boolean): void {
    this.settings.showGain = show;
    this.render();
  }

  /** 対局開始前: 配られた直後の盤面を操作できない状態で見せておく */
  preview(): void {
    this.invalidate();
    this.state = newGame((Math.random() * 2 ** 31) | 0, HUMAN);
    this.phase = 'waiting';
    this.dealtAt = performance.now();
    this.render();
  }

  start(settings: Settings): void {
    this.settings = { ...settings };
    this.level = settings.level;
    this.stage.setSpeed(settings.anim);
    this.invalidate();
    this.closeModal();
    const first =
      settings.start === 'human' ? HUMAN : settings.start === 'ai' ? AI : Math.random() < 0.5 ? HUMAN : AI;
    this.state = newGame((Math.random() * 2 ** 31) | 0, first);
    this.selected = null;
    this.pendingMove = null;
    this.lastDest = null;
    this.plies = [];
    this.rounds = [];
    this.undoStack = [];
    this.finalState = null;
    this.mode = 'play';
    this.phase = 'idle';
    this.dealtAt = performance.now();
    this.render();
    void this.continueTurn(this.token);
  }

  /** 進行中の AI 思考・演出・自動再生をすべて打ち切る */
  private invalidate(): void {
    this.token++;
    this.ai.discard();
    this.stage.cancel();
    this.autoplay = false;
    this.stepping = -1;
  }

  // ---------------- 入力 ----------------

  private onKey(e: KeyboardEvent): void {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape' && this.selected) {
      this.selected = null;
      this.render();
      return;
    }
    if (this.mode !== 'review' || e.altKey || e.ctrlKey || e.metaKey) return;
    const target = e.target as HTMLElement | null;
    if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
    if (e.key === 'ArrowLeft') this.goto(this.cursor - 1);
    else if (e.key === 'ArrowRight') void this.step();
    else if (e.key === 'Home') this.goto(0);
    else if (e.key === 'End') this.goto(this.plies.length);
    else return;
    e.preventDefault();
  }

  private onPick(src: number, color: number): void {
    if (!this.canAct()) return;
    const sel = this.selected;
    this.selected = sel && sel.src === src && sel.color === color ? null : { src, color };
    this.render();
  }

  private onPlace(dest: number): void {
    if (!this.canAct() || !this.selected) return;
    const m = encodeMove(this.selected.src, this.selected.color, dest);
    this.selected = null;
    this.undoStack.push(this.plies.length);
    void this.play(m, this.token);
  }

  private canAct(): boolean {
    return this.mode === 'play' && this.phase === 'idle' && !this.state[OVER] && this.state[CUR] === HUMAN;
  }

  private undo(): void {
    const k = this.undoStack.pop();
    if (k === undefined) return;
    this.invalidate();
    this.closeModal();
    this.mode = 'play';
    this.finalState = null;
    this.state = this.plies[k].state.slice();
    this.plies.length = k;
    this.rounds = this.rounds.filter((r) => r.atPly <= k);
    this.selected = null;
    this.pendingMove = null;
    this.lastDest = null;
    this.phase = 'idle';
    this.render();
  }

  // ---------------- 進行 ----------------

  private async play(m: Move, token: number): Promise<void> {
    const before = this.state.slice();
    const player = before[CUR];
    this.plies.push({ state: before, move: m, player, round: before[ROUND], summary: summarizeMove(before, m) });
    this.pumpAnalysis();
    this.pendingMove = null;
    this.phase = 'moving';
    applyMove(this.state, m);
    this.lastDest = player === AI ? { player, dest: moveDest(m) } : null;
    await this.stage.animateMove(before, m, () => this.render());
    if (token !== this.token) return;

    if (roundOver(this.state)) {
      const round = this.state[ROUND];
      const pre = this.state.slice();
      const report: RoundReport = { players: [], gameOver: false };
      this.phase = 'scoring';
      this.lastDest = null;
      this.render();
      await this.stage.sleep(250);
      if (token !== this.token) return;
      scoreRoundEnd(this.state, report);
      await this.stage.animateScoring(pre, report, (s) => this.render(s));
      if (token !== this.token) return;
      this.rounds.push({ atPly: this.plies.length, round, report });
      if (this.state[OVER]) {
        this.finish();
        return;
      }
      await this.stage.banner(getCopy(this.settings.locale).roundBanner(round + 1));
      if (token !== this.token) return;
      startRound(this.state);
      this.dealtAt = performance.now();
    }
    this.phase = 'idle';
    this.render();
    await this.continueTurn(token);
  }

  private async continueTurn(token: number): Promise<void> {
    if (token !== this.token || this.state[OVER] || this.state[CUR] !== AI) return;
    this.phase = 'thinking';
    this.render();
    const started = performance.now();
    const res = await this.ai.request({ state: this.state.slice(), level: this.level });
    if (token !== this.token || !res) return;
    const elapsed = performance.now() - started;
    if (elapsed < this.timing.aiMinMs) await wait(this.timing.aiMinMs - elapsed);
    if (token !== this.token) return;
    // 取るタイルと置き先を少し見せてから動かす
    this.pendingMove = { src: moveSrc(res.move), color: moveColor(res.move), dest: moveDest(res.move), player: AI };
    this.phase = 'moving';
    this.render();
    await this.stage.sleep(this.timing.aiPickMs);
    if (token !== this.token) return;
    await this.play(res.move, token);
  }

  private finish(): void {
    this.finalState = this.state.slice();
    this.phase = 'idle';
    this.lastDest = null;
    this.mode = 'review';
    this.cursor = this.plies.length;
    this.render();
    this.showResult();
    this.pumpAnalysis();
  }

  // ---------------- 解析(対局中は裏で進め、結果は終局後にだけ見せる) ----------------

  private pumpAnalysis(): void {
    if (this.analyzing) return;
    const ply = this.plies.find((p) => !p.analysis);
    if (!ply) return;
    this.analyzing = true;
    void this.analyst.request({ state: ply.state.slice(), level: 'max', analysisMs: this.timing.analysisMs }).then((res) => {
      this.analyzing = false;
      if (res && res.score !== null) {
        const sideToMove = ply.state[CUR];
        const { value, decided } = toPoints(sideToMove === HUMAN ? res.score : -res.score);
        ply.analysis = { value, decided, best: res.move };
      }
      if (this.mode === 'review' && this.plies.includes(ply)) this.renderReviewPanel();
      this.pumpAnalysis();
    });
  }

  /** 局面 i(0..手数)の評価値。終局は確定した点差 */
  private evalAt(i: number): Analysis | null {
    if (i >= this.plies.length) {
      const f = this.finalState;
      if (!f) return null;
      return { value: f[pOff(HUMAN) + P_SCORE] - f[pOff(AI) + P_SCORE], decided: true, best: -1 };
    }
    return this.plies[i].analysis ?? null;
  }

  /** 手 i で指した側が失った評価値(ラウンド最後の手は補充の運が混ざるので除く) */
  private lossAt(i: number): number | null {
    const ply = this.plies[i];
    if (this.rounds.some((r) => r.atPly === i + 1)) return null;
    const a = this.evalAt(i);
    const b = this.evalAt(i + 1);
    if (!a || !b) return null;
    const sign = ply.player === HUMAN ? 1 : -1;
    return sign * (a.value - b.value);
  }

  // ---------------- 振り返り ----------------

  private positionAt(i: number): State {
    return i >= this.plies.length ? this.finalState! : this.plies[i].state;
  }

  private goto(i: number): void {
    if (this.mode !== 'review') return;
    this.invalidate();
    this.cursor = Math.max(0, Math.min(this.plies.length, i));
    this.render();
  }

  /** 1 手進める(タイルの移動と得点計算の演出つき) */
  private async step(): Promise<boolean> {
    if (this.mode !== 'review') return false;
    // 演出の途中でもう一度進めたら、その手は演出を飛ばして終わらせる
    if (this.stepping >= 0) this.cursor = this.stepping + 1;
    const keepPlaying = this.autoplay;
    this.invalidate();
    if (this.cursor >= this.plies.length) {
      this.render();
      return false;
    }
    this.autoplay = keepPlaying;
    this.stepping = this.cursor;
    const token = this.token;
    const ply = this.plies[this.cursor];
    const s = ply.state.slice();
    applyMove(s, ply.move);
    await this.stage.animateMove(ply.state, ply.move, () => this.render(s, { review: false }));
    if (token !== this.token) return false;
    if (roundOver(s)) {
      const pre = s.slice();
      const report: RoundReport = { players: [], gameOver: false };
      scoreRoundEnd(s, report);
      await this.stage.animateScoring(pre, report, (x) => this.render(x, { review: false }));
      if (token !== this.token) return false;
    }
    this.stepping = -1;
    this.cursor++;
    this.render();
    return true;
  }

  private async togglePlay(): Promise<void> {
    if (this.autoplay) {
      this.autoplay = false;
      this.renderReviewPanel();
      return;
    }
    if (this.cursor >= this.plies.length) this.goto(0);
    const run = ++this.playRun;
    this.autoplay = true;
    this.renderReviewPanel();
    while (this.autoplay && run === this.playRun && this.cursor < this.plies.length) {
      if (!(await this.step())) return;
      await (this.stage.enabled ? this.stage.sleep(450) : wait(700));
    }
    if (run !== this.playRun) return;
    this.autoplay = false;
    this.renderReviewPanel();
  }

  // ---------------- 描画 ----------------

  private viewModel(state: State, review: boolean): ViewModel {
    const copy = getCopy(this.settings.locale);
    const ply = review ? this.plies[this.cursor] : undefined;
    const mark = (m: Move, player: number): MoveMark => ({ src: moveSrc(m), color: moveColor(m), dest: moveDest(m), player });
    const best = ply?.analysis?.best;
    const elapsed = performance.now() - this.dealtAt;
    return {
      state,
      locale: this.settings.locale,
      human: HUMAN,
      names: [copy.you, copy.ai],
      tags: ['', copy.levels[this.level]],
      selected: this.selected,
      pending: ply ? mark(ply.move, ply.player) : this.pendingMove,
      suggestion: ply && best !== undefined && best >= 0 && !sameMove(ply.state, best, ply.move) ? mark(best, ply.player) : null,
      lastDest: review ? null : this.lastDest,
      dealt: this.mode === 'play' && elapsed < 1500 ? elapsed : null,
      interactive: this.canAct(),
      showGain: this.settings.showGain && this.mode === 'play' && this.phase !== 'scoring',
    };
  }

  private render(state?: State, opts: { review?: boolean } = {}): void {
    if (!this.state) return;
    const review = opts.review ?? this.mode === 'review';
    const shown = state ?? (this.mode === 'review' ? this.positionAt(this.cursor) : this.state);
    const vm = this.viewModel(shown, review && !state);
    const h = { onPick: (s: number, c: number) => this.onPick(s, c), onPlace: (d: number) => this.onPlace(d) };
    renderBoard(this.dom.aiBoard, vm, AI, h);
    renderMarket(this.dom.market, vm, h);
    renderBoard(this.dom.humanBoard, vm, HUMAN, h);
    document.body.classList.toggle('reviewing', this.mode === 'review');
    this.dom.undo.disabled = this.undoStack.length === 0;
    this.renderStatus();
    this.renderLog();
    this.renderReviewPanel();
  }

  private renderStatus(): void {
    const s = this.state;
    const copy = getCopy(this.settings.locale);
    const st = this.dom.status;
    st.className = 'status';
    st.replaceChildren();
    if (this.mode === 'review') {
      const f = this.finalState!;
      st.textContent = copy.finalStatus(this.resultLabel(winner(f)), f[pOff(HUMAN) + P_SCORE], f[pOff(AI) + P_SCORE]);
      st.classList.add('over');
      return;
    }
    const round = s[ROUND];
    if (this.phase === 'waiting') {
      st.textContent = copy.waiting;
    } else if (this.phase === 'scoring') {
      st.textContent = copy.scoring(round);
      st.classList.add('busy');
    } else if (this.phase === 'thinking') {
      st.textContent = copy.aiThinking(round);
      st.classList.add('thinking');
    } else if (s[CUR] === AI) {
      st.textContent = copy.aiMoving(round);
      st.classList.add('busy');
    } else if (this.selected) {
      st.append(copy.chooseDestination(round, copy.colors[this.selected.color]));
      st.classList.add('mine');
    } else {
      st.textContent = copy.yourTurn(round);
      st.classList.add('mine');
    }
  }

  private moveTiles(summary: MoveSummary): HTMLElement {
    const tiles = el('span', 'mv-tiles');
    for (let i = 0; i < Math.min(summary.count, 4); i++) tiles.append(tileEl(summary.color, this.settings.locale, 'mini'));
    if (summary.count > 4) tiles.append(el('span', 'mv-more', `+${summary.count - 4}`));
    tiles.setAttribute('aria-label', `${getCopy(this.settings.locale).colors[summary.color]} ×${summary.count}`);
    return tiles;
  }

  private renderLog(): void {
    const ul = this.dom.log;
    const copy = getCopy(this.settings.locale);
    ul.replaceChildren();
    const review = this.mode === 'review';
    const header = (round: number): void => {
      ul.append(el('li', 'round-head', copy.roundHeader(round)));
    };
    let round = 0;
    this.plies.forEach((ply, i) => {
      if (ply.round !== round) {
        round = ply.round;
        header(round);
      }
      const li = el('li', `mv ${ply.player === HUMAN ? 'me' : 'ai'}`);
      li.append(
        el('span', 'mv-no', String(i + 1)),
        el('span', 'mv-who', ply.player === HUMAN ? copy.you : copy.ai),
        this.moveTiles(ply.summary),
        el('span', 'mv-text', formatMoveShort(ply.summary, this.settings.locale)),
      );
      li.title = formatMove(ply.summary, this.settings.locale);
      if (review) {
        const loss = this.lossAt(i);
        if (loss !== null && loss >= 3) li.append(el('span', `mv-flag ${loss >= 6 ? 'severe' : 'minor'}`, loss >= 6 ? copy.blunder : copy.inaccuracy));
        li.classList.add('jump');
        li.tabIndex = 0;
        li.addEventListener('click', () => this.goto(i));
        li.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') this.goto(i);
        });
        if (i === this.cursor) li.classList.add('current');
      }
      ul.append(li);
      const done = this.rounds.find((r) => r.atPly === i + 1);
      if (done) {
        const res = el('li', 'round-result');
        done.report.players.forEach((pr, p) => {
          const d = pr.scoreAfter - pr.scoreBefore;
          res.append(el('span', p === HUMAN ? 'me' : 'ai', copy.roundGain(p === HUMAN ? copy.you : copy.ai, `${d >= 0 ? '+' : ''}${d} → ${pr.scoreAfter}`)));
        });
        ul.append(res);
      }
    });
    if (!review && this.plies.length > 0) {
      const last = ul.querySelector('li.mv:last-of-type');
      last?.classList.add('latest');
    }
    const focus = review ? ul.querySelector<HTMLElement>('.current') : null;
    ul.scrollTop = focus ? focus.offsetTop - ul.clientHeight / 2 : ul.scrollHeight;
  }

  private formatEval(a: Analysis | null, copy: Copy): string {
    if (!a) return '…';
    const v = Math.round(a.value * 10) / 10;
    const text = Math.abs(v) < 0.5 ? copy.evenEval : `${v > 0 ? copy.youBetter : copy.aiBetter} +${Math.abs(v).toFixed(1)}`;
    return a.decided && Math.abs(v) >= 0.5 ? `${text} (${copy.decided})` : text;
  }

  private renderReviewPanel(): void {
    const root = this.dom.review;
    root.hidden = this.mode !== 'review';
    if (this.mode !== 'review') {
      root.replaceChildren();
      return;
    }
    const copy = getCopy(this.settings.locale);
    const n = this.plies.length;
    root.replaceChildren();
    const head = el('div', 'review-head');
    head.append(el('h2', '', copy.reviewTitle));
    const done = this.plies.filter((p) => p.analysis).length;
    if (done < n) head.append(el('span', 'analyzing', copy.analyzing(done, n)));
    root.append(head);

    const graph = el('div', 'graph');
    root.append(graph);
    const values = Array.from({ length: n + 1 }, (_, i) => this.evalAt(i)?.value ?? null);
    const marks: { index: number; severe: boolean }[] = [];
    for (let i = 0; i < n; i++) {
      const loss = this.lossAt(i);
      if (loss !== null && loss >= 3) marks.push({ index: i, severe: loss >= 6 });
    }
    renderEvalGraph(graph, {
      values,
      roundStarts: this.rounds.filter((r) => r.atPly < n).map((r) => ({ index: r.atPly, round: r.round + 1 })),
      marks,
      cursor: this.cursor,
      labels: { above: copy.youBetter, below: copy.aiBetter, round: copy.roundShort },
      describe: (i) => {
        const where = i >= n ? copy.finalPosition : i === 0 ? copy.startPosition : copy.plyLabel(i, this.plies[i].round);
        return `${where} · ${this.formatEval(this.evalAt(i), copy)}`;
      },
      onSelect: (i) => this.goto(i),
    });

    const legend = el('p', 'graph-legend');
    legend.append(el('span', 'dot'), document.createTextNode(copy.mistakeLegend));
    root.append(legend);

    const controls = el('div', 'review-controls');
    const button = (label: string, icon: string, fn: () => void, disabled: boolean): HTMLButtonElement => {
      const b = el('button', 'icon-btn', icon);
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      return b;
    };
    const atStart = this.cursor <= 0;
    const atEnd = this.cursor >= n;
    controls.append(
      button(copy.first, '⏮', () => this.goto(0), atStart),
      button(copy.prev, '◀', () => this.goto(this.cursor - 1), atStart),
      button(this.autoplay ? copy.pause : copy.play, this.autoplay ? '⏸' : '▶', () => void this.togglePlay(), false),
      button(copy.next, '▶|', () => void this.step(), atEnd),
      button(copy.last, '⏭', () => this.goto(n), atEnd),
      el('span', 'review-pos', `${this.cursor} / ${n}`),
    );
    controls.querySelectorAll('.icon-btn')[2]?.classList.add('play');
    root.append(controls);

    const info = el('div', 'review-info');
    const ply = this.plies[this.cursor];
    const now = this.evalAt(this.cursor);
    if (!ply) {
      info.append(el('div', 'ri-title', copy.finalPosition));
      const f = this.finalState!;
      info.append(el('div', 'ri-eval', `${copy.you} ${f[pOff(HUMAN) + P_SCORE]} – ${f[pOff(AI) + P_SCORE]} ${copy.ai}`));
    } else {
      info.append(el('div', 'ri-title', copy.plyLabel(this.cursor + 1, ply.round)));
      const mv = el('div', `ri-move ${ply.player === HUMAN ? 'me' : 'ai'}`);
      mv.append(
        el('span', 'mv-who', ply.player === HUMAN ? copy.you : copy.ai),
        this.moveTiles(ply.summary),
        el('span', '', formatMoveShort(ply.summary, this.settings.locale)),
      );
      info.append(mv);
      const next = this.evalAt(this.cursor + 1);
      const ev = el('div', 'ri-eval');
      ev.append(el('span', 'ri-label', copy.evalLabel), document.createTextNode(copy.evalChange(this.formatEval(now, copy), this.formatEval(next, copy))));
      const loss = this.lossAt(this.cursor);
      if (loss !== null && loss >= 3) ev.append(el('span', `mv-flag ${loss >= 6 ? 'severe' : 'minor'}`, `${loss >= 6 ? copy.blunder : copy.inaccuracy} ${copy.lossBy(loss.toFixed(1))}`));
      info.append(ev);
      const best = ply.analysis?.best;
      if (best !== undefined) {
        const same = sameMove(ply.state, best, ply.move);
        const b = el('div', `ri-best ${same ? 'same' : ''}`);
        if (same) b.textContent = `✓ ${copy.matchedBest}`;
        else {
          const summary = summarizeMove(ply.state, best);
          b.append(el('span', 'ri-label', copy.bestMove('')), this.moveTiles(summary), document.createTextNode(formatMoveShort(summary, this.settings.locale)));
        }
        info.append(b);
      }
    }
    root.append(info, el('p', 'review-hint', copy.reviewHint));
  }

  // ---------------- 結果 ----------------

  private showResult(): void {
    const copy = getCopy(this.settings.locale);
    const f = this.finalState!;
    const w = winner(f);
    const m = this.dom.modal;
    m.replaceChildren();
    const box = el('div', 'modal-box result-box');
    box.append(el('p', `result ${w === HUMAN ? 'win' : w === AI ? 'lose' : 'draw'}`, this.resultLabel(w)));
    const scores = el('div', 'final-scores');
    for (const p of [HUMAN, AI]) {
      const card = el('div', `final-card ${p === HUMAN ? 'me' : 'ai'}${w === p ? ' winner' : ''}`);
      card.append(el('span', 'fc-name', p === HUMAN ? copy.you : copy.ai), el('b', 'fc-score', String(f[pOff(p) + P_SCORE])));
      const bonus = this.rounds[this.rounds.length - 1]?.report.players[p].bonus;
      const ul = el('ul', 'fc-bonus');
      if (bonus?.rows) ul.append(el('li', '', copy.rowBonus(bonus.rows)));
      if (bonus?.cols) ul.append(el('li', '', copy.columnBonus(bonus.cols)));
      if (bonus?.colors) ul.append(el('li', '', copy.colorBonus(bonus.colors)));
      if (!ul.childElementCount) ul.append(el('li', 'muted', copy.noBonus));
      card.append(ul);
      scores.append(card);
    }
    box.append(el('h3', 'fc-title', copy.bonusTitle), scores);
    const actions = el('div', 'modal-actions');
    const review = el('button', 'primary', copy.review);
    review.type = 'button';
    review.addEventListener('click', () => m.close());
    const again = el('button', '', copy.newGame);
    again.type = 'button';
    again.addEventListener('click', () => {
      m.close();
      this.hooks.onNewGame?.();
    });
    actions.append(again, review);
    box.append(actions);
    m.append(box);
    m.showModal();
    review.focus();
  }

  private closeModal(): void {
    if (this.dom.modal.open) this.dom.modal.close();
  }

  private resultLabel(winnerId: number): string {
    const copy = getCopy(this.settings.locale);
    return winnerId === HUMAN ? copy.youWin : winnerId === AI ? copy.aiWin : copy.draw;
  }
}
