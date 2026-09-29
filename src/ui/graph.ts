const SVG = 'http://www.w3.org/2000/svg';

export interface GraphOptions {
  /** 各局面の評価値(あなた視点・点差)。未解析は null */
  values: readonly (number | null)[];
  /** 各ラウンドの最初の局面のインデックス(ラウンド 2 以降) */
  roundStarts: readonly { index: number; round: number }[];
  /** 大きく評価を落とした手の直前の局面 */
  marks: readonly { index: number; severe: boolean }[];
  cursor: number;
  labels: { above: string; below: string; round: (n: number) => string };
  /** ホバー時のツールチップ文言 */
  describe(index: number): string;
  onSelect(index: number): void;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** 評価値の推移グラフ。上半分があなた有利、下半分が AI 有利 */
export function renderEvalGraph(root: HTMLElement, o: GraphOptions): void {
  root.replaceChildren();
  const W = Math.max(220, Math.round(root.clientWidth || 280));
  const H = 150;
  const pad = { l: 6, r: 6, t: 14, b: 8 };
  const n = o.values.length;
  const known = o.values.filter((v): v is number => v !== null);
  const peak = Math.max(10, ...known.map(Math.abs));
  const ymax = Math.min(60, Math.ceil(peak / 10) * 10);
  const x = (i: number): number => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - pad.l - pad.r));
  const y = (v: number): number => {
    const c = Math.max(-ymax, Math.min(ymax, v));
    return pad.t + ((ymax - c) / (2 * ymax)) * (H - pad.t - pad.b);
  };
  const y0 = y(0);

  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'graph-svg', role: 'img' });
  const id = `g${Math.random().toString(36).slice(2, 8)}`;
  const defs = svg('defs', {});
  const clipUp = svg('clipPath', { id: `${id}u` });
  clipUp.append(svg('rect', { x: 0, y: 0, width: W, height: y0 }));
  const clipDown = svg('clipPath', { id: `${id}d` });
  clipDown.append(svg('rect', { x: 0, y: y0, width: W, height: H - y0 }));
  defs.append(clipUp, clipDown);
  s.append(defs);

  // 目盛り(±ymax/2 と 0)
  for (const v of [ymax / 2, -ymax / 2]) {
    s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
  }
  s.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y0, y2: y0, class: 'zero' }));
  const tick = (v: number, cls: string, text: string): void => {
    const t = svg('text', { x: pad.l + 2, y: y(v), class: `tick ${cls}` });
    t.textContent = text;
    s.append(t);
  };
  tick(ymax, 'top', `+${ymax}  ${o.labels.above}`);
  tick(-ymax, 'bottom', `−${ymax}  ${o.labels.below}`);

  for (const r of o.roundStarts) {
    const xi = x(r.index - 0.5);
    s.append(svg('line', { x1: xi, x2: xi, y1: pad.t - 4, y2: H - pad.b, class: 'round' }));
    const t = svg('text', { x: xi + 3, y: H - pad.b - 3, class: 'tick round-label' });
    t.textContent = o.labels.round(r.round);
    s.append(t);
  }

  // 解析済みの連続区間ごとに線と面を描く
  let line = '';
  let area = '';
  let run: [number, number][] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    line += run.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    area += `M${x(run[0][0]).toFixed(1)},${y0}` + run.map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('') + `L${x(run[run.length - 1][0]).toFixed(1)},${y0}Z`;
    run = [];
  };
  o.values.forEach((v, i) => (v === null ? flush() : run.push([i, v])));
  flush();
  s.append(
    svg('path', { d: area, class: 'area up', 'clip-path': `url(#${id}u)` }),
    svg('path', { d: area, class: 'area down', 'clip-path': `url(#${id}d)` }),
    svg('path', { d: line, class: 'line' }),
  );

  for (const m of o.marks) {
    const v = o.values[m.index + 1];
    if (v === null || v === undefined) continue;
    s.append(svg('circle', { cx: x(m.index + 1), cy: y(v), r: 3.5, class: `mark ${m.severe ? 'severe' : 'minor'}` }));
  }

  const cur = Math.max(0, Math.min(n - 1, o.cursor));
  s.append(svg('line', { x1: x(cur), x2: x(cur), y1: pad.t - 4, y2: H - pad.b, class: 'cursor' }));
  const cv = o.values[cur];
  if (cv !== null && cv !== undefined) s.append(svg('circle', { cx: x(cur), cy: y(cv), r: 4.5, class: 'cursor-dot' }));

  const hover = svg('line', { x1: 0, x2: 0, y1: pad.t - 4, y2: H - pad.b, class: 'hover', visibility: 'hidden' });
  s.append(hover);
  const hit = svg('rect', { x: 0, y: 0, width: W, height: H, class: 'hit' });
  s.append(hit);

  const tip = document.createElement('div');
  tip.className = 'graph-tip';
  tip.hidden = true;
  const indexAt = (e: PointerEvent): number => {
    const box = s.getBoundingClientRect();
    const px = ((e.clientX - box.left) / (box.width || W)) * W;
    const t = (px - pad.l) / (W - pad.l - pad.r);
    return Math.max(0, Math.min(n - 1, Math.round(t * (n - 1))));
  };
  hit.addEventListener('pointermove', (e) => {
    const i = indexAt(e);
    hover.setAttribute('x1', String(x(i)));
    hover.setAttribute('x2', String(x(i)));
    hover.setAttribute('visibility', 'visible');
    tip.textContent = o.describe(i);
    tip.hidden = false;
    const left = (x(i) / W) * 100;
    tip.style.left = `${left}%`;
    tip.classList.toggle('flip', left > 60);
  });
  hit.addEventListener('pointerleave', () => {
    hover.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  });
  hit.addEventListener('click', (e) => o.onSelect(indexAt(e as PointerEvent)));

  root.append(s, tip);
}
