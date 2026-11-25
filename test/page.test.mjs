import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absoluteCss, candidates, outline, readPage } from '../api/_lib/page.js';
import { planEvents, planOf, readAreas } from '../api/site.js';
import { privateAddress, publicUrl } from '../api/_lib/web.js';
import { buildPrompt } from '../site/assets/prompt.js';

test('only public web addresses are read', () => {
  for (const bad of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.5/x', 'http://192.168.1.1', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[fd00::1]/', 'ftp://example.org', 'file:///etc/passwd', 'https://user:pw@example.org/', 'https://example.org:8080/', 'intranet', 'http://printer.local/', 'https://service.internal/x', 'javascript:alert(1)']) {
    assert.throws(() => publicUrl(bad), /./, bad);
  }
  assert.equal(publicUrl('example.org/pricing#plans').href, 'https://example.org/pricing');
  assert.equal(publicUrl('http://Example.org').href, 'http://example.org/');
  assert.equal(publicUrl('https://8.8.8.8/').hostname, '8.8.8.8');
  for (const ip of ['10.1.2.3', '172.20.0.1', '100.64.0.1', '0.0.0.0', '::1', '::ffff:10.0.0.1', 'fe80::1', 'fc00::1']) assert.equal(privateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(privateAddress(ip), false, ip);
});

const SOURCE = `<!doctype html><html lang="en" class="dark" onload="x()"><head><title>Pricing | Acme</title>
<link rel="stylesheet" href="/app.css"><link rel="stylesheet" media="print" href="/print.css"><style>.a{background:url(img/a.png)}</style>
<script>track()</script></head><body class="home" data-theme="night"><!-- note --><header><a href="/login" onclick="go()" target="_blank">Sign in</a></header>
<main><section class="plans"><h2>Plans for every team</h2><ul>${['Starter', 'Team', 'Company'].map((name) => `<li class="plan"><h3>${name}</h3><p>Everything you need to get going with ${name}.</p><img src="/img/${name}.png" srcset="/x 2x" alt="${name}"><svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"/></svg><button>Choose ${name}</button></li>`).join('')}</ul></section>
<img data-src="lazy.png" src="data:image/gif;base64,AAAA"><noscript><img src="/fallback.png"></noscript><script>more()</script><iframe src="/x"></iframe></main></body></html>`;

test('a page is read without what would run, with whole addresses', () => {
  const page = readPage(SOURCE, 'https://acme.example.org/pricing/');
  assert.equal(page.title, 'Pricing | Acme');
  assert.deepEqual(page.html, { lang: 'en', class: 'dark' });
  assert.deepEqual(page.body, { class: 'home', 'data-theme': 'night' });
  assert.deepEqual(page.sheets, [{ href: 'https://acme.example.org/app.css' }, { text: '.a{background:url("https://acme.example.org/pricing/img/a.png")}' }]);
  assert.doesNotMatch(page.page, /<script|<iframe|<noscript|onclick|srcset|<!--|target=/);
  assert.match(page.page, /<a href="#">Sign in<\/a>/);
  assert.match(page.page, /<img alt="Starter" src="https:\/\/acme\.example\.org\/img\/Starter\.png">/);
  assert.match(page.page, /<img src="https:\/\/acme\.example\.org\/pricing\/lazy\.png">/, 'a picture that is loaded late has its real address');
  assert.equal(absoluteCss('@import "other.css"; @import url(https://fonts.googleapis.com/css2?family=Inter); a{background:url(data:x)}', 'https://a.example.org/'), ' @import url("https://fonts.googleapis.com/css2?family=Inter"); a{background:url(data:x)}');
});

test('the parts that could be an area are found, with their place in the page', () => {
  const { page } = readPage(SOURCE, 'https://acme.example.org/pricing/');
  // The three plans are a group, marked for the page that shows them.
  assert.match(page, /<ul data-pe-group="3"><li class="plan" data-pe-item="">/);
  const list = candidates(page);
  assert.equal(list.length, 1);
  const [plans] = list;
  assert.equal(plans.kind, 'group');
  assert.equal(plans.items, 3);
  // The area is the group with the heading above it.
  assert.match(page.slice(plans.from, plans.to), /^<section class="plans">[\s\S]*<\/section>$/);
  assert.equal(plans.title, 'Plans for every team');
  assert.deepEqual(plans.fits, ['grid', 'zigzag', 'scroller', 'featured']);
  assert.equal(outline(list), '[1] 3 items under the heading "Plans for every team", each with a heading, text, a picture, a link: "Starter" / "Team" / "Company". Can be: grid, zigzag, scroller, featured');
  assert.deepEqual(candidates('<div>short</div>'), []);
});

test('a heading with what belongs to it is a block; a menu, a pair of unlike things and a mark of the page itself are not parts', () => {
  const source = `<body><nav><ul>${['Product', 'Pricing', 'Docs'].map((name) => `<li class="l"><a href="/x">${name} and more words here</a></li>`).join('')}</ul></nav>
<header class="hero"><div class="copy"><h1>Ship your work faster</h1><p>Everything a small team needs to plan, build and release.</p><a class="b" href="/start">Get started</a></div><img src="/shot.png" width="1200" height="800" alt=""></header>
<section class="two"><div class="c"><h2>Why teams switch</h2></div><div class="c"><p>${'A long line of text about the product and what it does for the people who use it. '.repeat(6)}</p><img src="/a.png" alt=""></div></section>
<div data-pe-group="9" data-pe-item="">x</div><video poster="/poster.jpg" class="film"><source src="/film.mp4"></video></body>`;
  const { page } = readPage(source, 'https://acme.example.org/');
  assert.doesNotMatch(page, /data-pe-group="9"/, 'a mark that the page brought is taken off');
  assert.match(page, /<img class="film" alt="" src="https:\/\/acme\.example\.org\/poster\.jpg">/, 'a film is shown as its poster');
  const list = candidates(page);
  // The menu is no part; the heading beside a long text is no pair of cards, but a block with that text.
  assert.deepEqual(list.map((c) => [c.kind, c.heading]), [['block', 'Ship your work faster'], ['block', 'Why teams switch']]);
  assert.equal(list[0].opens, true);
  assert.deepEqual(list[0].fits, ['centered', 'left', 'split']);
  assert.match(page.slice(list[0].from, list[0].to), /^<header class="hero">/);
  assert.match(outline(list), /^\[1\] a block that opens the page: the heading "Ship your work faster", text, 1 link, a picture\. Can be: centered, left, split\n\[2\] a block: the heading "Why teams switch", text, a picture\./);
});

test('the answer about a live page is read into areas, and without one the page still has some', () => {
  const { page } = readPage(SOURCE, 'https://acme.example.org/pricing/');
  const list = candidates(page);
  const { areas, summary } = readAreas(`@@AREA 1 | How the plans are compared
@@PICK grid | Three plans with the same features are compared fastest side by side.
@@PICK sidebar | Not an arrangement.
@@PICK grid | Named twice.
@@AREA 1 | The same part again
@@PICK rows | x
@@AREA 7 | No such part
@@PICK grid | x
@@SUMMARY A pricing page.
@@END`, list);
  assert.equal(summary, 'A pricing page.');
  assert.equal(areas.length, 1);
  assert.deepEqual(areas[0].picks, [{ id: 'grid', because: 'Three plans with the same features are compared fastest side by side.' }]);
  const plan = planOf(list, areas, 'en');
  // What the model gave a reason for comes first; then the other arrangements the part can take.
  assert.deepEqual(plan[0].options.map((o) => o.id), ['grid', 'zigzag', 'scroller', 'featured']);
  const events = planEvents(plan, { file: 'https://acme.example.org/pricing/', title: 'Pricing', summary });
  assert.deepEqual(events.map((e) => e.t), ['plan', 'place', 'screen', 'option', 'option', 'option', 'option']);
  assert.deepEqual(events[3], { t: 'option', area: 'area-1', id: 'grid', recipe: 'grid', pattern: 'card-grid', because: 'Three plans with the same features are compared fastest side by side.' });
  assert.equal(events[4].because, undefined);
  // No answer: the groups of the page are offered, nothing suggested, named in the page's language.
  const bare = planOf(list, readAreas('I cannot help with that.', list).areas, 'ko');
  assert.equal(bare[0].label, '항목 배치 방식');
  assert.ok(bare[0].options.every((o) => !o.because));
});

test('the prompt for a live page names its address', () => {
  const analysis = { site: true, screen: { title: 'Pricing', file: 'https://acme.example.org/pricing/' }, areas: [{ id: 'a', label: 'How the plans are compared', options: [{ id: 'keep', keep: true, label: '' }, { id: 'pricing-table', label: 'Plans side by side', pattern: 'pricing-table' }] }] };
  assert.match(buildPrompt(analysis, { a: 'pricing-table' }, 'en'), /^Use the picky-eater skill on the Pricing page of this project\. It is live at https:\/\/acme\.example\.org\/pricing\/\.\n\nI tried it on the web and lean toward:\n- How the plans are compared: plans side by side \(pricing-table\)/);
  assert.match(buildPrompt(analysis, {}, 'ko'), /^picky-eater 스킬로 이 프로젝트의 Pricing 페이지를 다듬어 줘\./);
});
