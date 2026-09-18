/** 定石ページの組み立て。定義とレンダラを繋ぐだけ。 */

import { PATTERNS, CATEGORIES } from '../core/patterns.js';
import { renderPattern, renderSwatch } from './pattern-render.js';

const $ = (id) => document.getElementById(id);

const LEGEND = [
  { kind: 'line', label: 'もとから分かっている線' },
  { kind: 'cross', label: 'もとから分かっている ×（線を引かない場所）' },
  { kind: 'new-line', label: 'ここが線で確定する' },
  { kind: 'new-cross', label: 'ここが × で確定する' },
];

function buildLegend() {
  const list = $('legend');
  for (const item of LEGEND) {
    const li = document.createElement('li');
    li.appendChild(renderSwatch(item.kind));
    const span = document.createElement('span');
    span.textContent = item.label;
    li.appendChild(span);
    list.appendChild(li);
  }
}

function buildPatterns() {
  const main = $('patterns');
  const toc = $('toc');

  for (const category of CATEGORIES) {
    const items = PATTERNS.filter((p) => p.category === category.id);
    if (items.length === 0) continue;

    const tocItem = document.createElement('li');
    const tocLink = document.createElement('a');
    tocLink.href = `#${category.id}`;
    tocLink.textContent = category.title;
    tocItem.appendChild(tocLink);
    toc.appendChild(tocItem);

    const section = document.createElement('section');
    section.className = 'pat-section';
    section.id = category.id;

    const h2 = document.createElement('h2');
    h2.textContent = category.title;
    const lead = document.createElement('p');
    lead.className = 'pat-lead';
    lead.textContent = category.lead;
    section.append(h2, lead);

    const grid = document.createElement('div');
    grid.className = 'pat-grid';
    for (const pattern of items) grid.appendChild(card(pattern));
    section.appendChild(grid);
    main.appendChild(section);
  }
}

function card(pattern) {
  const article = document.createElement('article');
  article.className = 'pat-card';
  article.id = `pattern-${pattern.id}`;

  const h3 = document.createElement('h3');
  h3.textContent = pattern.title;

  const figure = document.createElement('div');
  figure.className = 'pat-figure';
  figure.appendChild(renderPattern(pattern));

  const why = document.createElement('p');
  why.className = 'pat-why';
  why.textContent = pattern.why;

  article.append(h3, figure, why);

  if (pattern.caution) {
    const caution = document.createElement('p');
    caution.className = 'pat-caution';
    caution.textContent = pattern.caution;
    article.appendChild(caution);
  }
  return article;
}

function setupTheme() {
  const saved = readPrefs().theme;
  if (saved) document.documentElement.dataset.theme = saved;
  $('btn-theme').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = root.dataset.theme || (dark ? 'dark' : 'light');
    root.dataset.theme = current === 'dark' ? 'light' : 'dark';
    const prefs = readPrefs();
    prefs.theme = root.dataset.theme;
    try { localStorage.setItem('slitherlink:prefs', JSON.stringify(prefs)); } catch { /* 無視 */ }
  });
}

function readPrefs() {
  try { return JSON.parse(localStorage.getItem('slitherlink:prefs') || '{}'); }
  catch { return {}; }
}

setupTheme();
buildLegend();
buildPatterns();
