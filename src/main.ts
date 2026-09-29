import type { Level } from './ai/worker';
import type { AnimSpeed } from './ui/animate';
import { Game, type Settings, type StartChoice } from './ui/controller';
import { applyStaticText, type Locale } from './ui/i18n';

const SETTINGS_KEY = 'azul-settings';
const LEVELS: readonly Level[] = ['easy', 'normal', 'hard', 'max'];
const START_CHOICES: readonly StartChoice[] = ['human', 'ai', 'random'];
const LOCALES: readonly Locale[] = ['en', 'ja'];
const ANIMS: readonly AnimSpeed[] = ['normal', 'fast', 'off'];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const newGameDialog = $<HTMLDialogElement>('newgame-dialog');
const settingsDialog = $<HTMLDialogElement>('settings-dialog');
const newGameForm = newGameDialog.querySelector('form')!;
const settingsForm = settingsDialog.querySelector('form')!;

function isOneOf<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === 'string' && choices.some((choice: T): boolean => choice === value);
}

function browserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

function loadSettings(): Settings {
  const defaults: Settings = { level: 'max', start: 'random', locale: browserLocale(), anim: 'normal', showGain: true };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return defaults;
    const values = saved as Record<string, unknown>;
    return {
      level: isOneOf(values.level, LEVELS) ? values.level : defaults.level,
      start: isOneOf(values.start, START_CHOICES) ? values.start : defaults.start,
      locale: isOneOf(values.locale, LOCALES) ? values.locale : defaults.locale,
      anim: isOneOf(values.anim, ANIMS) ? values.anim : defaults.anim,
      showGain: typeof values.showGain === 'boolean' ? values.showGain : defaults.showGain,
    };
  } catch {
    // Private browsing can disable storage; the game still works with browser defaults.
    return defaults;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The selected settings remain usable for this page load.
  }
}

function radio(form: HTMLFormElement, name: string): RadioNodeList {
  return form.elements.namedItem(name) as RadioNodeList;
}

const settings = loadSettings();
applyStaticText(settings.locale);

const game = new Game(
  {
    aiBoard: $('board-ai'),
    humanBoard: $('board-human'),
    market: $('market'),
    status: $('status'),
    log: $('log'),
    review: $('review'),
    modal: $<HTMLDialogElement>('modal'),
    undo: $<HTMLButtonElement>('undo'),
  },
  settings,
  undefined,
  { onNewGame: () => openNewGame() },
);

let started = false;
const cancelButton = newGameForm.querySelector<HTMLButtonElement>('button[value="cancel"]')!;

function openNewGame(): void {
  radio(newGameForm, 'level').value = settings.level;
  radio(newGameForm, 'start').value = settings.start;
  // 最初の 1 局は始めるしかないので取り消せない
  cancelButton.hidden = !started;
  newGameDialog.returnValue = '';
  newGameDialog.showModal();
}

newGameDialog.addEventListener('cancel', (e) => {
  if (!started) e.preventDefault();
});

$('new-game').addEventListener('click', openNewGame);
newGameDialog.addEventListener('close', () => {
  if (newGameDialog.returnValue !== 'start') {
    // ブラウザによっては Esc を 2 回押すと cancel を止められずに閉じるので開き直す
    if (!started) openNewGame();
    return;
  }
  const level = radio(newGameForm, 'level').value;
  const start = radio(newGameForm, 'start').value;
  if (isOneOf(level, LEVELS)) settings.level = level;
  if (isOneOf(start, START_CHOICES)) settings.start = start;
  saveSettings();
  started = true;
  game.start(settings);
});

$('settings-btn').addEventListener('click', () => {
  radio(settingsForm, 'locale').value = settings.locale;
  radio(settingsForm, 'anim').value = settings.anim;
  (settingsForm.elements.namedItem('showGain') as HTMLInputElement).checked = settings.showGain;
  settingsDialog.showModal();
});
settingsForm.addEventListener('change', () => {
  const locale = radio(settingsForm, 'locale').value;
  const anim = radio(settingsForm, 'anim').value;
  const showGain = (settingsForm.elements.namedItem('showGain') as HTMLInputElement).checked;
  if (isOneOf(locale, LOCALES) && locale !== settings.locale) {
    settings.locale = locale;
    applyStaticText(locale);
    game.setLocale(locale);
  }
  if (isOneOf(anim, ANIMS) && anim !== settings.anim) {
    settings.anim = anim;
    game.setAnimation(anim);
  }
  if (showGain !== settings.showGain) {
    settings.showGain = showGain;
    game.setShowGain(showGain);
  }
  saveSettings();
});

$('rules-btn').addEventListener('click', (): void => $<HTMLDialogElement>('rules').showModal());
// ダイアログの外側(背景)をクリックしたら閉じる
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && (started || dialog !== newGameDialog)) dialog.close();
  });
}

game.preview();
openNewGame();
