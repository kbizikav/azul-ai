import type { Level } from './ai/worker';
import { Game, type Settings, type StartChoice } from './ui/controller';
import { applyStaticText, type Locale } from './ui/i18n';

const SETTINGS_KEY = 'azul-settings';
const LEVELS: readonly Level[] = ['easy', 'normal', 'hard', 'max'];
const START_CHOICES: readonly StartChoice[] = ['human', 'ai', 'random'];
const LOCALES: readonly Locale[] = ['en', 'ja'];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const levelSel = $<HTMLSelectElement>('level');
const startSel = $<HTMLSelectElement>('start');
const languageSel = $<HTMLSelectElement>('language');

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some((choice: T): boolean => choice === value);
}

function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function loadSettings(): Settings {
  const defaults: Settings = { level: 'max', start: 'random', locale: browserLocale() };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const values = saved as Record<string, unknown>;
    return {
      level: isOneOf(values.level, LEVELS) ? values.level : defaults.level,
      start: isOneOf(values.start, START_CHOICES) ? values.start : defaults.start,
      locale: isOneOf(values.locale, LOCALES) ? values.locale : defaults.locale,
    };
  } catch {
    // Private browsing can disable storage; the game still works with browser defaults.
    return defaults;
  }
}

function currentSettings(): Settings {
  const settings: Settings = {
    level: levelSel.value as Level,
    start: startSel.value as StartChoice,
    locale: languageSel.value as Locale,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The selected settings remain usable for this page load.
  }
  return settings;
}

const initial = loadSettings();
levelSel.value = initial.level;
startSel.value = initial.start;
languageSel.value = initial.locale;
applyStaticText(initial.locale);

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
  initial,
);

$('new-game').addEventListener('click', (): void => game.start(currentSettings()));
levelSel.addEventListener('change', (): void => game.setLevel(currentSettings().level));
startSel.addEventListener('change', (): void => { currentSettings(); });
languageSel.addEventListener('change', (): void => {
  const settings = currentSettings();
  applyStaticText(settings.locale);
  game.setLocale(settings.locale);
});
$('rules-btn').addEventListener('click', (): void => $<HTMLDialogElement>('rules').showModal());

game.start(initial);
