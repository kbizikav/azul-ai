// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiRequest } from '../src/ai/worker';
import { Searcher } from '../src/ai/search';
import { Game } from '../src/ui/controller';
import { applyStaticText, type Locale } from '../src/ui/i18n';

class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  private searcher = new Searcher();
  postMessage(req: AiRequest): void {
    setTimeout(() => {
      const r = this.searcher.search(req.state, { timeMs: 15 });
      this.onmessage?.({ data: { id: req.id, ...r } } as MessageEvent);
    }, 0);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

beforeAll(() => {
  vi.stubGlobal('Worker', FakeWorker);
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  document.body.innerHTML = html.split('<body>')[1].split('<script')[0];
});

function makeGame(start: 'human' | 'ai', locale: Locale = 'ja'): Game {
  const settings = { level: 'hard' as const, start, locale, anim: 'off' as const, showGain: true };
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
    { aiMinMs: 0, aiPickMs: 0, analysisMs: 10 },
  );
  game.start(settings);
  return game;
}

describe('UI', () => {
  it('switches the interface and existing move history between English and Japanese', () => {
    applyStaticText('en');
    const game = makeGame('human', 'en');
    expect(document.documentElement.lang).toBe('en');
    expect($('new-game').textContent).toBe('New game');
    expect($('status').textContent).toContain('Your turn');
    expect(document.querySelector('#board-human .board-name')?.textContent).toBe('You');
    expect(document.querySelector('#market .factory')?.getAttribute('aria-label')).toBe('Factory 1');
    expect($('review').hidden).toBe(true);

    document.querySelector<HTMLElement>('#market .tile.clickable')!.click();
    document.querySelector<HTMLElement>('#board-human .floor.target')!.click();
    expect($('log').textContent).toContain('Factory');

    applyStaticText('ja');
    game.setLocale('ja');
    expect(document.documentElement.lang).toBe('ja');
    expect($('new-game').textContent).toBe('新しいゲーム');
    expect($('log').textContent).toContain('工場');
    expect(document.querySelector('#board-human .board-name')?.textContent).toBe('あなた');
    $<HTMLButtonElement>('undo').click();
  });

  it.each([
    { locale: 'ja', gameOver: 'ゲーム終了', review: '振り返る' },
    { locale: 'en', gameOver: 'Game over', review: 'Review' },
  ] as const)('plays a complete game in $locale and reviews it', async ({ locale, gameOver, review }) => {
    applyStaticText(locale);
    makeGame('human', locale);
    let humanMoves = 0;
    const modal = $<HTMLDialogElement>('modal');
    for (let step = 0; step < 5000 && !modal.open; step++) {
      const tile = document.querySelector<HTMLElement>('#market .tile.clickable');
      if (tile) {
        tile.click();
        expect(document.querySelector('#market .tile.selected')).not.toBeNull();
        const target =
          document.querySelector<HTMLElement>('#board-human .line.target') ??
          document.querySelector<HTMLElement>('#board-human .floor.target');
        expect(target).not.toBeNull();
        target!.click();
        humanMoves++;
      }
      await tick();
    }
    expect(modal.open).toBe(true);
    expect(humanMoves).toBeGreaterThan(5);
    expect(document.querySelectorAll('#log .round-result').length).toBeGreaterThanOrEqual(5);
    expect($('status').textContent).toContain(gameOver);
    const moves = document.querySelectorAll('#log li.mv').length;
    expect(moves).toBeGreaterThan(10);

    // 評価値は終局後にだけ表示される
    const reviewBtn = [...modal.querySelectorAll('button')].find((b) => b.textContent === review)!;
    reviewBtn.click();
    expect(modal.open).toBe(false);
    expect($('review').hidden).toBe(false);
    for (let i = 0; i < 5000 && document.querySelector('#review .analyzing'); i++) await tick();
    expect(document.querySelector('#review .analyzing')).toBeNull();
    const path = document.querySelector('#review .graph-svg path.line')!.getAttribute('d')!;
    expect(path.split('L').length).toBe(moves + 1);
    expect(document.querySelector('#board-human .tile.clickable')).toBeNull();

    // リプレイ: 最初の局面へ戻り、1手ずつ進める
    document.querySelector<HTMLElement>('#log li.mv')!.click();
    expect(document.querySelector('#log li.current .mv-no')?.textContent).toBe('1');
    expect(document.querySelector('#market .tile.picked')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    await tick();
    expect(document.querySelector('#log li.current .mv-no')?.textContent).toBe('2');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    expect(document.querySelector('#review .review-pos')?.textContent).toBe(`${moves} / ${moves}`);
  }, 120000);

  it('AI先手で始まり、1手戻すで自分の手番に戻る', async () => {
    makeGame('ai');
    for (let i = 0; i < 50 && !document.querySelector('#market .tile.clickable'); i++) await tick();
    expect(document.querySelectorAll('#log li.mv').length).toBe(1); // AI の初手
    const tile = document.querySelector<HTMLElement>('#market .tile.clickable')!;
    tile.click();
    document.querySelector<HTMLElement>('#board-human .floor.target')!.click();
    for (let i = 0; i < 50 && !document.querySelector('#market .tile.clickable'); i++) await tick();
    expect(document.querySelectorAll('#log li.mv').length).toBe(3);
    $<HTMLButtonElement>('undo').click();
    expect(document.querySelectorAll('#log li.mv').length).toBe(1);
    expect(document.querySelector('#market .tile.clickable')).not.toBeNull();
    expect($<HTMLButtonElement>('undo').disabled).toBe(true);
  });
});
