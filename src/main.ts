import type { Level } from './ai/worker';
import { Game, type Settings, type StartChoice } from './ui/controller';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const levelSel = $<HTMLSelectElement>('level');
const startSel = $<HTMLSelectElement>('start');

function load(): void {
  try {
    const saved = JSON.parse(localStorage.getItem('azul-settings') ?? '{}') as Partial<Settings>;
    if (saved.level) levelSel.value = saved.level;
    if (saved.start) startSel.value = saved.start;
  } catch {
    /* 保存領域が使えなくても遊べる */
  }
}

function current(): Settings {
  const s: Settings = { level: levelSel.value as Level, start: startSel.value as StartChoice };
  try {
    localStorage.setItem('azul-settings', JSON.stringify(s));
  } catch {
    /* noop */
  }
  return s;
}

load();

const game = new Game(
  {
    aiBoard: $('board-ai'),
    humanBoard: $('board-human'),
    market: $('market'),
    status: $('status'),
    aiInfo: $('ai-info'),
    log: $('log'),
    modal: $<HTMLDialogElement>('modal'),
    undo: $<HTMLButtonElement>('undo'),
  },
  current(),
);

$('new-game').addEventListener('click', () => game.start(current()));
levelSel.addEventListener('change', () => game.setLevel(current().level));
startSel.addEventListener('change', () => current());
$('rules-btn').addEventListener('click', () => $<HTMLDialogElement>('rules').showModal());

game.start(current());
