import type { AiRequest, AiResponse, Level } from '../ai/worker';
import { advance, describeMove, newGame, winner, type RoundReport } from '../engine/rules';
import { COLOR_NAMES, CUR, OVER, P_SCORE, ROUND, encodeMove, moveColor, moveDest, moveSrc, pOff, type Move, type State } from '../engine/state';
import { renderBoard, renderMarket, tileEl, type Selection, type ViewModel } from './render';

const HUMAN = 0;
const AI = 1;
const NAMES = ['あなた', 'AI'];

export type StartChoice = 'human' | 'ai' | 'random';

export interface Settings {
  level: Level;
  start: StartChoice;
}

const LEVEL_LABEL: Record<Level, string> = { easy: 'かんたん', normal: 'ふつう', hard: 'つよい', max: '最強' };

interface LogEntry {
  player: number;
  text: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Game {
  private state!: State;
  private settings: Settings;
  private selected: Selection | null = null;
  private aiPick: Selection | null = null;
  private lastDest: ViewModel['lastDest'] = null;
  private newWall: ViewModel['newWall'] = [];
  private busy = false; // AI 思考中・演出中・モーダル表示中
  private log: LogEntry[] = [];
  private undoStack: { state: State; log: LogEntry[] }[] = [];
  private token = 0; // 新規ゲーム/Undo で進行中の非同期処理を無効化する
  private worker: Worker;
  private reqId = 0;
  private pending = new Map<number, (r: AiResponse) => void>();
  private aiInfo = '';

  constructor(
    private readonly dom: {
      aiBoard: HTMLElement;
      humanBoard: HTMLElement;
      market: HTMLElement;
      status: HTMLElement;
      aiInfo: HTMLElement;
      log: HTMLElement;
      modal: HTMLDialogElement;
      undo: HTMLButtonElement;
    },
    settings: Settings,
    private readonly timing = { aiMinMs: 500, aiPickMs: 650 },
  ) {
    this.settings = settings;
    this.worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<AiResponse>) => {
      const cb = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      cb?.(e.data);
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selected) {
        this.selected = null;
        this.render();
      }
    });
    dom.undo.addEventListener('click', () => this.undo());
  }

  setLevel(level: Level): void {
    this.settings.level = level;
    this.renderStatus();
  }

  start(settings: Settings): void {
    this.settings = settings;
    this.token++;
    this.closeModal();
    const first =
      settings.start === 'human' ? HUMAN : settings.start === 'ai' ? AI : Math.random() < 0.5 ? HUMAN : AI;
    this.state = newGame((Math.random() * 2 ** 31) | 0, first);
    this.selected = null;
    this.aiPick = null;
    this.lastDest = null;
    this.newWall = [];
    this.log = [];
    this.undoStack = [];
    this.aiInfo = '';
    this.busy = false;
    this.render();
    void this.continueTurn(this.token);
  }

  // ---------------- 入力 ----------------

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
    this.undoStack.push({ state: this.state.slice(), log: this.log.slice() });
    void this.play(m, this.token);
  }

  private canAct(): boolean {
    return !this.busy && !this.state[OVER] && this.state[CUR] === HUMAN;
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.token++;
    this.reqId++; // 思考中の AI の結果は捨てる
    this.closeModal();
    this.state = prev.state;
    this.log = prev.log;
    this.selected = null;
    this.aiPick = null;
    this.lastDest = null;
    this.newWall = [];
    this.busy = false;
    this.aiInfo = '';
    this.render();
  }

  // ---------------- 進行 ----------------

  private async play(m: Move, token: number): Promise<void> {
    const player = this.state[CUR];
    this.log.push({ player, text: describeMove(this.state, m) });
    const report = advance(this.state, m);
    this.lastDest = { player, dest: moveDest(m) };
    this.newWall = [];
    this.aiPick = null;
    if (report) {
      this.lastDest = null;
      report.players.forEach((pr, p) => pr.placements.forEach((pl) => this.newWall.push({ player: p, row: pl.row, col: pl.col })));
      this.busy = true;
      this.render();
      await this.showRoundReport(report);
      if (token !== this.token) return;
      this.busy = false;
      this.newWall = [];
    }
    this.render();
    await this.continueTurn(token);
  }

  private async continueTurn(token: number): Promise<void> {
    if (token !== this.token) return;
    if (this.state[OVER]) {
      this.render();
      return;
    }
    if (this.state[CUR] !== AI) {
      this.render();
      return;
    }
    this.busy = true;
    this.render();
    const started = performance.now();
    const res = await this.askAi();
    if (token !== this.token || !res) return;
    const elapsed = performance.now() - started;
    if (elapsed < this.timing.aiMinMs) await wait(this.timing.aiMinMs - elapsed);
    if (token !== this.token) return;
    this.aiInfo = this.formatAiInfo(res);
    // 取るタイルを一瞬ハイライトしてから指す
    this.aiPick = { src: moveSrc(res.move), color: moveColor(res.move) };
    this.render();
    await wait(this.timing.aiPickMs);
    if (token !== this.token) return;
    this.busy = false;
    await this.play(res.move, token);
  }

  private askAi(): Promise<AiResponse | null> {
    const id = ++this.reqId;
    const req: AiRequest = { id, state: this.state.slice(), level: this.settings.level };
    return new Promise((resolve) => {
      this.pending.set(id, (r) => resolve(id === this.reqId ? r : null));
      this.worker.postMessage(req);
    });
  }

  private formatAiInfo(r: AiResponse): string {
    if (r.score === null) return `${LEVEL_LABEL[this.settings.level]}: 直感で指しました`;
    const sc = r.score;
    const lead = Math.abs(sc) < 0.5 ? '互角' : sc > 0 ? `AI 有利 (+${sc.toFixed(1)})` : `あなた有利 (+${(-sc).toFixed(1)})`;
    const depth = r.solved ? 'ラウンド終了まで読み切り' : `${r.depth}手先まで探索`;
    const nodes = r.nodes >= 1e6 ? `${(r.nodes / 1e6).toFixed(1)}M` : `${Math.round(r.nodes / 1e3)}k`;
    return `${depth} · ${nodes}局面 · ${(r.timeMs / 1000).toFixed(1)}秒\nAIの形勢判断: ${Math.abs(sc) >= 500 ? (sc > 0 ? 'AIの勝ちを読み切り' : 'あなたの勝ちを読み切り') : lead}`;
  }

  // ---------------- モーダル ----------------

  private showRoundReport(report: RoundReport): Promise<void> {
    const round = this.state[ROUND] - (report.gameOver ? 0 : 1);
    const m = this.dom.modal;
    m.replaceChildren();
    const box = document.createElement('div');
    box.className = 'modal-box';
    const h = document.createElement('h2');
    h.textContent = report.gameOver ? 'ゲーム終了' : `ラウンド ${round} 終了`;
    box.append(h);
    const table = document.createElement('div');
    table.className = 'report';
    for (const p of [HUMAN, AI]) {
      const pr = report.players[p];
      const col = document.createElement('div');
      col.className = 'report-col';
      const title = document.createElement('h3');
      title.textContent = NAMES[p];
      col.append(title);
      const ul = document.createElement('ul');
      for (const pl of pr.placements) {
        const li = document.createElement('li');
        li.append(tileEl(pl.color, 'mini'), document.createTextNode(` ${pl.row + 1}段目 +${pl.points}`));
        ul.append(li);
      }
      if (pr.placements.length === 0) ul.append(Object.assign(document.createElement('li'), { textContent: '壁への配置なし' }));
      if (pr.floorPenalty) ul.append(Object.assign(document.createElement('li'), { className: 'neg', textContent: `床 ${pr.floorPenalty}` }));
      if (pr.bonus) {
        const b = pr.bonus;
        if (b.rows) ul.append(Object.assign(document.createElement('li'), { textContent: `横列ボーナス ${b.rows}×2 = +${b.rows * 2}` }));
        if (b.cols) ul.append(Object.assign(document.createElement('li'), { textContent: `縦列ボーナス ${b.cols}×7 = +${b.cols * 7}` }));
        if (b.colors) ul.append(Object.assign(document.createElement('li'), { textContent: `色ボーナス ${b.colors}×10 = +${b.colors * 10}` }));
      }
      col.append(ul);
      const total = document.createElement('div');
      total.className = 'report-total';
      const d = pr.scoreAfter - pr.scoreBefore;
      total.textContent = `${pr.scoreBefore} → ${pr.scoreAfter} (${d >= 0 ? '+' : ''}${d})`;
      col.append(total);
      table.append(col);
    }
    box.append(table);
    if (report.gameOver) {
      const w = winner(this.state);
      const res = document.createElement('p');
      res.className = 'result ' + (w === HUMAN ? 'win' : w === AI ? 'lose' : 'draw');
      res.textContent = w === HUMAN ? 'あなたの勝ち!' : w === AI ? 'AIの勝ち' : '引き分け';
      box.append(res);
    }
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = report.gameOver ? '閉じる' : '次のラウンドへ';
    box.append(btn);
    m.append(box);
    m.showModal();
    btn.focus();
    return new Promise((resolve) => {
      const done = () => {
        m.removeEventListener('close', done);
        resolve();
      };
      m.addEventListener('close', done);
      btn.addEventListener('click', () => m.close());
    });
  }

  private closeModal(): void {
    if (this.dom.modal.open) this.dom.modal.close();
  }

  // ---------------- 描画 ----------------

  private render(): void {
    const vm: ViewModel = {
      state: this.state,
      human: HUMAN,
      selected: this.selected,
      aiPick: this.aiPick,
      lastDest: this.lastDest,
      newWall: this.newWall,
      interactive: this.canAct(),
    };
    const h = { onPick: (s: number, c: number) => this.onPick(s, c), onPlace: (d: number) => this.onPlace(d) };
    renderBoard(this.dom.aiBoard, vm, AI, 'AI', h);
    renderMarket(this.dom.market, vm, h);
    renderBoard(this.dom.humanBoard, vm, HUMAN, 'あなた', h);
    this.dom.undo.disabled = this.undoStack.length === 0;
    this.renderStatus();
    this.renderLog();
  }

  private renderStatus(): void {
    const s = this.state;
    const st = this.dom.status;
    st.className = 'status';
    if (s[OVER]) {
      const w = winner(s);
      st.textContent = `ゲーム終了 — ${w === HUMAN ? 'あなたの勝ち!' : w === AI ? 'AIの勝ち' : '引き分け'}(${s[pOff(HUMAN) + P_SCORE]} 対 ${s[pOff(AI) + P_SCORE]})`;
      st.classList.add('over');
    } else if (s[CUR] === AI) {
      st.textContent = `ラウンド ${s[ROUND]} · AI(${LEVEL_LABEL[this.settings.level]})が考えています…`;
      st.classList.add('thinking');
    } else if (this.selected) {
      st.textContent = `ラウンド ${s[ROUND]} · ${COLOR_NAMES[this.selected.color]}を置く段を選んでください(Escで取り消し)`;
    } else {
      st.textContent = `ラウンド ${s[ROUND]} · あなたの番です。工場か中央のタイルを選んでください`;
    }
    this.dom.aiInfo.textContent = this.aiInfo;
  }

  private renderLog(): void {
    const ul = this.dom.log;
    ul.replaceChildren();
    for (let i = this.log.length - 1; i >= 0 && i >= this.log.length - 40; i--) {
      const e = this.log[i];
      const li = document.createElement('li');
      li.className = e.player === HUMAN ? 'me' : 'ai';
      li.textContent = `${NAMES[e.player]}: ${e.text}`;
      ul.append(li);
    }
  }
}
