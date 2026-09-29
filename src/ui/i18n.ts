import type { Level } from '../ai/worker';
import { CENTER, CTR, FACT, FLOOR_DEST, NUM_COLORS, moveColor, moveDest, moveSrc, type Move, type State } from '../engine/state';

export type Locale = 'en' | 'ja';

export interface MoveSummary {
  src: number;
  color: number;
  count: number;
  dest: number;
}

export interface Copy {
  pageTitle: string;
  tagline: string;
  levelLabel: string;
  startLabel: string;
  languageLabel: string;
  animLabel: string;
  animNormal: string;
  animFast: string;
  animOff: string;
  gainLabel: string;
  settings: string;
  settingsTitle: string;
  newGame: string;
  newGameTitle: string;
  startGame: string;
  cancel: string;
  undo: string;
  undoTitle: string;
  rules: string;
  moveLog: string;
  levels: Record<Level, string>;
  startYou: string;
  startAi: string;
  startRandom: string;
  rulesTitle: string;
  ruleTakeTitle: string;
  ruleTakeBody: string;
  rulePlaceTitle: string;
  rulePlaceBody: string;
  ruleRoundTitle: string;
  ruleRoundBody: string;
  ruleEndTitle: string;
  ruleEndBody: string;
  controlsHint: string;
  gainHint: string;
  close: string;
  you: string;
  ai: string;
  colors: readonly string[];
  firstPlayerMarker: string;
  factory: (number: number) => string;
  center: string;
  points: string;
  projectedGain: string;
  placeRow: (number: number) => string;
  placeFloor: string;
  row: (number: number) => string;
  floor: string;
  move: (source: string, color: string, count: number, destination: string) => string;
  moveShort: (source: string, destination: string) => string;
  gameOver: string;
  roundBanner: (round: number) => string;
  roundHeader: (round: number) => string;
  roundGain: (name: string, gain: string) => string;
  rowBonus: (count: number) => string;
  columnBonus: (count: number) => string;
  colorBonus: (count: number) => string;
  noBonus: string;
  bonusTitle: string;
  youWin: string;
  aiWin: string;
  draw: string;
  finalStatus: (result: string, humanScore: number, aiScore: number) => string;
  aiThinking: (round: number) => string;
  aiMoving: (round: number) => string;
  scoring: (round: number) => string;
  chooseDestination: (round: number, color: string) => string;
  yourTurn: (round: number) => string;
  waiting: string;
  review: string;
  reviewTitle: string;
  reviewHint: string;
  reviewStatus: (position: number, total: number) => string;
  startPosition: string;
  finalPosition: string;
  plyLabel: (number: number, round: number) => string;
  evalLabel: string;
  evalValue: (value: string) => string;
  evalChange: (before: string, after: string) => string;
  youBetter: string;
  aiBetter: string;
  evenEval: string;
  decided: string;
  analyzing: (done: number, total: number) => string;
  bestMove: (move: string) => string;
  matchedBest: string;
  blunder: string;
  inaccuracy: string;
  lossBy: (points: string) => string;
  mistakeLegend: string;
  first: string;
  prev: string;
  play: string;
  pause: string;
  next: string;
  last: string;
  roundShort: (round: number) => string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    pageTitle: 'Azul — Play against AI',
    tagline: 'vs AI',
    levelLabel: 'Difficulty',
    startLabel: 'First player',
    languageLabel: 'Language',
    animLabel: 'Animations',
    animNormal: 'Normal',
    animFast: 'Fast',
    animOff: 'Off',
    gainLabel: 'Show points expected at the end of the round',
    settings: 'Settings',
    settingsTitle: 'Settings',
    newGame: 'New game',
    newGameTitle: 'Start a new game',
    startGame: 'Start',
    cancel: 'Cancel',
    undo: 'Undo',
    undoTitle: 'Go back to your previous turn',
    rules: 'Rules',
    moveLog: 'Moves',
    levels: { easy: 'Easy', normal: 'Normal', hard: 'Hard', max: 'Expert' },
    startYou: 'You',
    startAi: 'AI',
    startRandom: 'Random',
    rulesTitle: 'How to play Azul (2 players)',
    ruleTakeTitle: 'Take tiles:',
    ruleTakeBody: 'Take all tiles of one color from a factory, moving the rest to the center, or take all tiles of one color from the center. The first player to take from the center also takes the first-player marker onto their floor.',
    rulePlaceTitle: 'Fill a pattern line:',
    rulePlaceBody: 'Put the tiles on one line. Each line holds one color, and cannot hold a color already on that row of your wall. Tiles that do not fit go to the floor. You may also place them directly on the floor.',
    ruleRoundTitle: 'End of a round:',
    ruleRoundBody: 'When the factories and center are empty, move one tile from each complete line to its matching wall space. Score connected horizontal and vertical tiles. Discard the remaining tiles. Floor penalties are −1, −1, −2, −2, −2, −3, −3.',
    ruleEndTitle: 'End of the game:',
    ruleEndBody: 'The game ends after a round in which a player completes a horizontal wall row. Earn bonuses of +2 for each complete row, +7 for each complete column, and +10 for each set of five tiles of one color.',
    controlsHint: 'Click a tile in a factory or the center, then click a highlighted line or the floor.',
    gainHint: ' beside a score shows the points that player would gain if the round ended now.',
    close: 'Close',
    you: 'You',
    ai: 'AI',
    colors: ['blue', 'yellow', 'red', 'black', 'white'],
    firstPlayerMarker: 'first-player marker',
    factory: (number: number): string => `Factory ${number}`,
    center: 'Center',
    points: 'pts',
    projectedGain: 'Points gained if the round ended now',
    placeRow: (number: number): string => `Place on line ${number}`,
    placeFloor: 'Place on the floor',
    row: (number: number): string => `line ${number}`,
    floor: 'floor',
    move: (source: string, color: string, count: number, destination: string): string => `${source}: ${color} ×${count} → ${destination}`,
    moveShort: (source: string, destination: string): string => `${source} → ${destination}`,
    gameOver: 'Game over',
    roundBanner: (round: number): string => `Round ${round}`,
    roundHeader: (round: number): string => `Round ${round}`,
    roundGain: (name: string, gain: string): string => `${name} ${gain}`,
    rowBonus: (count: number): string => `Rows ${count} × 2 = +${count * 2}`,
    columnBonus: (count: number): string => `Columns ${count} × 7 = +${count * 7}`,
    colorBonus: (count: number): string => `Colors ${count} × 10 = +${count * 10}`,
    noBonus: 'No bonus',
    bonusTitle: 'End-of-game bonuses',
    youWin: 'You win!',
    aiWin: 'AI wins',
    draw: 'Draw',
    finalStatus: (result: string, humanScore: number, aiScore: number): string => `Game over — ${result} (${humanScore}–${aiScore})`,
    aiThinking: (round: number): string => `Round ${round} · AI is thinking…`,
    aiMoving: (round: number): string => `Round ${round} · AI's move`,
    scoring: (round: number): string => `Round ${round} · Scoring…`,
    chooseDestination: (round: number, color: string): string => `Round ${round} · Choose a line for ${color} (Esc to cancel)`,
    yourTurn: (round: number): string => `Round ${round} · Your turn. Choose a tile from a factory or the center.`,
    waiting: 'Choose your settings to start a new game.',
    review: 'Review',
    reviewTitle: 'Game review',
    reviewHint: 'Click the graph or use ← → to move through the game.',
    reviewStatus: (position: number, total: number): string => `Review · ${position} / ${total}`,
    startPosition: 'Start of the game',
    finalPosition: 'Final position',
    plyLabel: (number: number, round: number): string => `Move ${number} · Round ${round}`,
    evalLabel: 'Evaluation',
    evalValue: (value: string): string => value,
    evalChange: (before: string, after: string): string => `${before} → ${after}`,
    youBetter: 'You',
    aiBetter: 'AI',
    evenEval: 'Even',
    decided: 'decided',
    analyzing: (done: number, total: number): string => `Analyzing… ${done}/${total}`,
    bestMove: (move: string): string => `AI suggests: ${move}`,
    matchedBest: 'Matches the AI’s top choice',
    blunder: 'Blunder',
    inaccuracy: 'Inaccuracy',
    lossBy: (points: string): string => `−${points} pts`,
    mistakeLegend: 'marks a move that lost 3+ points of evaluation.',
    first: 'First position',
    prev: 'Previous move',
    play: 'Play',
    pause: 'Pause',
    next: 'Next move',
    last: 'Final position',
    roundShort: (round: number): string => `R${round}`,
  },
  ja: {
    pageTitle: 'Azul — AI対戦',
    tagline: 'vs AI',
    levelLabel: '強さ',
    startLabel: '先手',
    languageLabel: '言語',
    animLabel: 'アニメーション',
    animNormal: '標準',
    animFast: '速い',
    animOff: 'なし',
    gainLabel: 'ラウンド終了時の見込み得点を表示',
    settings: '設定',
    settingsTitle: '設定',
    newGame: '新しいゲーム',
    newGameTitle: '新しいゲームを始める',
    startGame: '開始',
    cancel: 'キャンセル',
    undo: '1手戻す',
    undoTitle: '自分の直前の手まで戻す',
    rules: 'ルール',
    moveLog: '棋譜',
    levels: { easy: 'かんたん', normal: 'ふつう', hard: 'つよい', max: '最強' },
    startYou: 'あなた',
    startAi: 'AI',
    startRandom: 'ランダム',
    rulesTitle: 'アズールのルール(2人用)',
    ruleTakeTitle: 'タイルを取る:',
    ruleTakeBody: '工場1つから同じ色をすべて取ります。残りは中央へ。または中央から同じ色をすべて取ります。中央から最初に取った人は先手マーカーも取り、床に置きます。',
    rulePlaceTitle: 'パターンラインに置く:',
    rulePlaceBody: '取ったタイルは1つの段に置きます。段ごとに1色だけで、壁のその段に同じ色がすでにあると置けません。入りきらない分は床へ。床に直接置くこともできます。',
    ruleRoundTitle: 'ラウンド終了:',
    ruleRoundBody: '工場と中央が空になると、埋まった段から1枚を壁の同じ色のマスへ移します。縦横につながったタイルの数だけ得点。残りのタイルは捨てられます。床のタイルは -1, -1, -2, -2, -2, -3, -3 点。',
    ruleEndTitle: 'ゲーム終了:',
    ruleEndBody: '誰かが壁の横1列を完成させたラウンドで終了。横1列 +2点、縦1列 +7点、同じ色5枚 +10点のボーナス。',
    controlsHint: '操作: 工場・中央のタイルをクリック → 光っている段(または床)をクリック。',
    gainHint: ' は今ラウンドが終わった場合に入る点数です。',
    close: '閉じる',
    you: 'あなた',
    ai: 'AI',
    colors: ['青', '黄', '赤', '黒', '白'],
    firstPlayerMarker: '先手マーカー',
    factory: (number: number): string => `工場${number}`,
    center: '中央',
    points: '点',
    projectedGain: '今ラウンドが終わった場合に入る点数',
    placeRow: (number: number): string => `${number}段目に置く`,
    placeFloor: '床に置く',
    row: (number: number): string => `${number}段目`,
    floor: '床',
    move: (source: string, color: string, count: number, destination: string): string => `${source}の${color}×${count} → ${destination}`,
    moveShort: (source: string, destination: string): string => `${source} → ${destination}`,
    gameOver: 'ゲーム終了',
    roundBanner: (round: number): string => `ラウンド ${round}`,
    roundHeader: (round: number): string => `ラウンド ${round}`,
    roundGain: (name: string, gain: string): string => `${name} ${gain}`,
    rowBonus: (count: number): string => `横列 ${count} × 2 = +${count * 2}`,
    columnBonus: (count: number): string => `縦列 ${count} × 7 = +${count * 7}`,
    colorBonus: (count: number): string => `色 ${count} × 10 = +${count * 10}`,
    noBonus: 'ボーナスなし',
    bonusTitle: '終了ボーナス',
    youWin: 'あなたの勝ち!',
    aiWin: 'AIの勝ち',
    draw: '引き分け',
    finalStatus: (result: string, humanScore: number, aiScore: number): string => `ゲーム終了 — ${result}(${humanScore} 対 ${aiScore})`,
    aiThinking: (round: number): string => `ラウンド ${round} · AIが考えています…`,
    aiMoving: (round: number): string => `ラウンド ${round} · AIの手`,
    scoring: (round: number): string => `ラウンド ${round} · 得点計算中…`,
    chooseDestination: (round: number, color: string): string => `ラウンド ${round} · ${color}を置く段を選んでください(Escで取り消し)`,
    yourTurn: (round: number): string => `ラウンド ${round} · あなたの番です。工場か中央のタイルを選んでください`,
    waiting: '設定を選んで新しいゲームを始めてください',
    review: '振り返る',
    reviewTitle: '対局の振り返り',
    reviewHint: 'グラフをクリック、または ← → キーで局面を移動できます。',
    reviewStatus: (position: number, total: number): string => `振り返り · ${position} / ${total}`,
    startPosition: '開始局面',
    finalPosition: '終局',
    plyLabel: (number: number, round: number): string => `${number}手目 · ラウンド ${round}`,
    evalLabel: '評価値',
    evalValue: (value: string): string => value,
    evalChange: (before: string, after: string): string => `${before} → ${after}`,
    youBetter: 'あなた',
    aiBetter: 'AI',
    evenEval: '互角',
    decided: '確定',
    analyzing: (done: number, total: number): string => `解析中… ${done}/${total}`,
    bestMove: (move: string): string => `AIの推奨: ${move}`,
    matchedBest: 'AIの推奨手と一致',
    blunder: '悪手',
    inaccuracy: '疑問手',
    lossBy: (points: string): string => `−${points}点`,
    mistakeLegend: 'は評価値を3点以上下げた手です。',
    first: '最初の局面',
    prev: '1手戻る',
    play: '再生',
    pause: '一時停止',
    next: '1手進む',
    last: '終局',
    roundShort: (round: number): string => `R${round}`,
  },
};

export function getCopy(locale: Locale): Copy {
  return COPY[locale];
}

export function summarizeMove(state: State, move: Move): MoveSummary {
  const src = moveSrc(move);
  const color = moveColor(move);
  const count = src < CENTER ? state[FACT + src * NUM_COLORS + color] : state[CTR + color];
  return { src, color, count, dest: moveDest(move) };
}

function parts(move: MoveSummary, locale: Locale): { source: string; destination: string } {
  const copy = getCopy(locale);
  return {
    source: move.src < CENTER ? copy.factory(move.src + 1) : copy.center,
    destination: move.dest === FLOOR_DEST ? copy.floor : copy.row(move.dest + 1),
  };
}

export function formatMove(move: MoveSummary, locale: Locale): string {
  const { source, destination } = parts(move, locale);
  return getCopy(locale).move(source, getCopy(locale).colors[move.color], move.count, destination);
}

/** 色と枚数はタイルの絵で見せるので、取得元と置き先だけの短い表記 */
export function formatMoveShort(move: MoveSummary, locale: Locale): string {
  const { source, destination } = parts(move, locale);
  return getCopy(locale).moveShort(source, destination);
}

export function applyStaticText(locale: Locale): void {
  const copy = getCopy(locale);
  document.documentElement.lang = locale;
  document.title = copy.pageTitle;
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const value: unknown = copy[element.dataset.i18n as keyof Copy];
    if (typeof value === 'string') element.textContent = value;
  }
  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const value: unknown = copy[element.dataset.i18nTitle as keyof Copy];
    if (typeof value === 'string') {
      element.title = value;
      element.setAttribute('aria-label', value);
    }
  }
  for (const level of ['easy', 'normal', 'hard', 'max'] as const) {
    for (const label of document.querySelectorAll<HTMLElement>(`[data-level-label="${level}"]`)) {
      label.textContent = copy.levels[level];
    }
  }
}
