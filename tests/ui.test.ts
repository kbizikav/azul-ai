// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AiRequest } from '../src/ai/worker';
import { Searcher } from '../src/ai/search';
import { Game } from '../src/ui/controller';

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

function makeGame(start: 'human' | 'ai'): Game {
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
    { level: 'hard', start },
    { aiMinMs: 0, aiPickMs: 0 },
  );
  game.start({ level: 'hard', start });
  return game;
}

describe('UI', () => {
  it('クリック操作で1局最後まで遊べる', async () => {
    makeGame('human');
    let humanMoves = 0;
    let rounds = 0;
    for (let step = 0; step < 5000; step++) {
      const modal = $<HTMLDialogElement>('modal');
      if (modal.open) {
        rounds++;
        const btn = modal.querySelector('button')!;
        const over = btn.textContent === '閉じる';
        btn.click();
        if (over) break;
        await tick();
        continue;
      }
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
    expect(humanMoves).toBeGreaterThan(5);
    expect(rounds).toBeGreaterThanOrEqual(5);
    expect($('status').textContent).toContain('ゲーム終了');
    expect(document.querySelectorAll('#log li').length).toBeGreaterThan(10);
  }, 60000);

  it('AI先手で始まり、1手戻すで自分の手番に戻る', async () => {
    makeGame('ai');
    for (let i = 0; i < 50 && !document.querySelector('#market .tile.clickable'); i++) await tick();
    expect(document.querySelectorAll('#log li').length).toBe(1); // AI の初手
    const tile = document.querySelector<HTMLElement>('#market .tile.clickable')!;
    tile.click();
    document.querySelector<HTMLElement>('#board-human .floor.target')!.click();
    for (let i = 0; i < 50 && !document.querySelector('#market .tile.clickable'); i++) await tick();
    expect(document.querySelectorAll('#log li').length).toBe(3);
    $<HTMLButtonElement>('undo').click();
    expect(document.querySelectorAll('#log li').length).toBe(1);
    expect(document.querySelector('#market .tile.clickable')).not.toBeNull();
    expect($<HTMLButtonElement>('undo').disabled).toBe(true);
  });
});
