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
  levelLabel: string;
  startLabel: string;
  languageLabel: string;
  newGame: string;
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
  gameOver: string;
  roundEnd: (round: number) => string;
  placement: (row: number, points: number) => string;
  noWallPlacement: string;
  floorPenalty: (points: number) => string;
  rowBonus: (count: number) => string;
  columnBonus: (count: number) => string;
  colorBonus: (count: number) => string;
  youWin: string;
  aiWin: string;
  draw: string;
  nextRound: string;
  finalStatus: (result: string, humanScore: number, aiScore: number) => string;
  aiThinking: (round: number, level: string) => string;
  chooseDestination: (round: number, color: string) => string;
  yourTurn: (round: number) => string;
  aiIntuition: (level: string) => string;
  even: string;
  aiAhead: (points: string) => string;
  youAhead: (points: string) => string;
  roundSolved: string;
  searchedPlies: (depth: number) => string;
  positions: (count: string) => string;
  seconds: (time: string) => string;
  assessment: (detail: string) => string;
  forcedAiWin: string;
  forcedYouWin: string;
}

const COPY: Record<Locale, Copy> = {
  en: {
    pageTitle: 'Azul — Play against AI',
    levelLabel: 'Difficulty',
    startLabel: 'First player',
    languageLabel: 'Language',
    newGame: 'New game',
    undo: 'Undo',
    undoTitle: 'Go back to your previous turn',
    rules: 'Rules',
    moveLog: 'Move history',
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
    gainHint: ' beside a score estimates points earned at the end of this round.',
    close: 'Close',
    you: 'You',
    ai: 'AI',
    colors: ['blue', 'yellow', 'red', 'black', 'white'],
    firstPlayerMarker: 'first-player marker',
    factory: (number: number): string => `Factory ${number}`,
    center: 'Center',
    points: ' pts',
    projectedGain: 'Estimated points at the end of this round',
    placeRow: (number: number): string => `Place on line ${number}`,
    placeFloor: 'Place on the floor',
    row: (number: number): string => `line ${number}`,
    floor: 'floor',
    move: (source: string, color: string, count: number, destination: string): string => `${source}: ${color} ×${count} → ${destination}`,
    gameOver: 'Game over',
    roundEnd: (round: number): string => `Round ${round} complete`,
    placement: (row: number, points: number): string => ` line ${row} +${points}`,
    noWallPlacement: 'No tiles added to the wall',
    floorPenalty: (points: number): string => `Floor ${points}`,
    rowBonus: (count: number): string => `Row bonus ${count}×2 = +${count * 2}`,
    columnBonus: (count: number): string => `Column bonus ${count}×7 = +${count * 7}`,
    colorBonus: (count: number): string => `Color bonus ${count}×10 = +${count * 10}`,
    youWin: 'You win!',
    aiWin: 'AI wins',
    draw: 'Draw',
    nextRound: 'Next round',
    finalStatus: (result: string, humanScore: number, aiScore: number): string => `Game over — ${result} (${humanScore}–${aiScore})`,
    aiThinking: (round: number, level: string): string => `Round ${round} · AI (${level}) is thinking…`,
    chooseDestination: (round: number, color: string): string => `Round ${round} · Choose a line for ${color} (Esc to cancel)`,
    yourTurn: (round: number): string => `Round ${round} · Your turn. Choose a tile from a factory or the center.`,
    aiIntuition: (level: string): string => `${level}: AI made an intuitive move`,
    even: 'Even',
    aiAhead: (points: string): string => `AI ahead (+${points})`,
    youAhead: (points: string): string => `You ahead (+${points})`,
    roundSolved: 'Searched to the end of the round',
    searchedPlies: (depth: number): string => `Searched ${depth} moves ahead`,
    positions: (count: string): string => `${count} positions`,
    seconds: (time: string): string => `${time}s`,
    assessment: (detail: string): string => `AI assessment: ${detail}`,
    forcedAiWin: 'AI sees a forced win',
    forcedYouWin: 'AI sees your forced win',
  },
  ja: {
    pageTitle: 'Azul — AI対戦',
    levelLabel: '強さ',
    startLabel: '先手',
    languageLabel: '言語',
    newGame: '新しいゲーム',
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
    gainHint: ' は今ラウンド終了時の予想獲得点です。',
    close: '閉じる',
    you: 'あなた',
    ai: 'AI',
    colors: ['青', '黄', '赤', '黒', '白'],
    firstPlayerMarker: '先手マーカー',
    factory: (number: number): string => `工場${number}`,
    center: '中央',
    points: ' 点',
    projectedGain: 'このラウンド終了時の予想得点',
    placeRow: (number: number): string => `${number}段目に置く`,
    placeFloor: '床に置く',
    row: (number: number): string => `${number}段目`,
    floor: '床',
    move: (source: string, color: string, count: number, destination: string): string => `${source}の${color}×${count} → ${destination}`,
    gameOver: 'ゲーム終了',
    roundEnd: (round: number): string => `ラウンド ${round} 終了`,
    placement: (row: number, points: number): string => ` ${row}段目 +${points}`,
    noWallPlacement: '壁への配置なし',
    floorPenalty: (points: number): string => `床 ${points}`,
    rowBonus: (count: number): string => `横列ボーナス ${count}×2 = +${count * 2}`,
    columnBonus: (count: number): string => `縦列ボーナス ${count}×7 = +${count * 7}`,
    colorBonus: (count: number): string => `色ボーナス ${count}×10 = +${count * 10}`,
    youWin: 'あなたの勝ち!',
    aiWin: 'AIの勝ち',
    draw: '引き分け',
    nextRound: '次のラウンドへ',
    finalStatus: (result: string, humanScore: number, aiScore: number): string => `ゲーム終了 — ${result}(${humanScore} 対 ${aiScore})`,
    aiThinking: (round: number, level: string): string => `ラウンド ${round} · AI(${level})が考えています…`,
    chooseDestination: (round: number, color: string): string => `ラウンド ${round} · ${color}を置く段を選んでください(Escで取り消し)`,
    yourTurn: (round: number): string => `ラウンド ${round} · あなたの番です。工場か中央のタイルを選んでください`,
    aiIntuition: (level: string): string => `${level}: 直感で指しました`,
    even: '互角',
    aiAhead: (points: string): string => `AI 有利 (+${points})`,
    youAhead: (points: string): string => `あなた有利 (+${points})`,
    roundSolved: 'ラウンド終了まで読み切り',
    searchedPlies: (depth: number): string => `${depth}手先まで探索`,
    positions: (count: string): string => `${count}局面`,
    seconds: (time: string): string => `${time}秒`,
    assessment: (detail: string): string => `AIの形勢判断: ${detail}`,
    forcedAiWin: 'AIの勝ちを読み切り',
    forcedYouWin: 'あなたの勝ちを読み切り',
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

export function formatMove(move: MoveSummary, locale: Locale): string {
  const copy = getCopy(locale);
  const source = move.src < CENTER ? copy.factory(move.src + 1) : copy.center;
  const destination = move.dest === FLOOR_DEST ? copy.floor : copy.row(move.dest + 1);
  return copy.move(source, copy.colors[move.color], move.count, destination);
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
    if (typeof value === 'string') element.title = value;
  }
  for (const level of ['easy', 'normal', 'hard', 'max'] as const) {
    const option = document.querySelector<HTMLOptionElement>(`#level option[value="${level}"]`);
    if (option) option.textContent = copy.levels[level];
  }
}
