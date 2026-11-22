import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absoluteCss, candidates, compact, outline, readPage, restore } from '../api/_lib/page.js';
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

test('the elements that could be an area are found, with their place in the page', () => {
  const { page } = readPage(SOURCE, 'https://acme.example.org/pricing/');
  const list = candidates(page, { min: 300 });
  const plans = list.find((c) => c.classes === 'plans');
  assert.ok(plans, 'the section with the plans');
  assert.match(page.slice(plans.from, plans.to), /^<section class="plans">[\s\S]*<\/section>$/);
  assert.equal(plans.parts.buttons, 3);
  assert.equal(list.find((c) => c.tag === 'ul').depth, plans.depth + 1, 'the list lies inside the section');
  assert.match(outline(list), /\[\d\] <section\.plans> \d+ chars, 3 buttons, 6 pictures: "Plans for every team Starter/);
  assert.deepEqual(candidates('<div>short</div>'), []);
});

test('an element is given to the model in short, and its pictures are put back', () => {
  const { page } = readPage(SOURCE, 'https://acme.example.org/pricing/');
  const plans = candidates(page, { min: 300 }).find((c) => c.classes === 'plans');
  const short = compact(plans.node);
  assert.equal(short.kept.length, 6);
  assert.doesNotMatch(short.html, /<path|src=/);
  assert.match(short.html, /<img data-keep="0" alt="Starter"><svg data-keep="1"><\/svg><button>Choose Starter<\/button>/);
  const answer = '<section class="plans"><table><tr><td><img data-keep="0" alt="Starter"></td><td><svg data-keep="1" class="x"></svg></td><td><img data-keep="99"></td></tr></table></section>';
  const whole = restore(answer, short.kept);
  assert.match(whole, /<td><img alt="Starter" src="https:\/\/acme\.example\.org\/img\/Starter\.png"><\/td><td><svg viewBox="0 0 24 24"><path d="M1 1h22v22H1z"><\/path><\/svg><\/td><td><\/td>/);
  // Empty shells are left out of what the model reads.
  const shells = candidates(`<div class="counter">${'<span class=""></span>'.repeat(40)}<b>Running total of everything</b>${'<p>More words here to make this long enough to count as a part of the page.</p>'.repeat(4)}</div>`, { min: 300 })[0];
  assert.doesNotMatch(compact(shells.node).html, /<span/);
});

test('the prompt for a live page names its address', () => {
  const analysis = { site: true, screen: { title: 'Pricing', file: 'https://acme.example.org/pricing/' }, areas: [{ id: 'a', label: 'How the plans are compared', options: [{ id: 'keep', keep: true, label: '' }, { id: 'pricing-table', label: 'Plans side by side', pattern: 'pricing-table' }] }] };
  assert.match(buildPrompt(analysis, { a: 'pricing-table' }, 'en'), /^Use the picky-eater skill on the Pricing page of this project\. It is live at https:\/\/acme\.example\.org\/pricing\/\.\n\nI tried it on the web and lean toward:\n- How the plans are compared: plans side by side \(pricing-table\)/);
  assert.match(buildPrompt(analysis, {}, 'ko'), /^picky-eater 스킬로 이 프로젝트의 Pricing 페이지를 다듬어 줘\./);
});
