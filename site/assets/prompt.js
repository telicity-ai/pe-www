// The prompt a visitor takes away, how it changes when they pick, and how a pick is merged
// into a prompt they have already edited.

const TEXT = {
  en: {
    intro: (title, file) => `Use the picky-eater skill on the ${title} screen of this project (${file}).`,
    introMany: 'Use the picky-eater skill on these screens of this project, one after another.',
    heading: (title, file) => `${title} screen (${file}):`,
    leaning: 'I tried it on the web and lean toward:',
    open: 'Still open, show me options for:',
    keep: 'keep it as it is',
    outro: 'Draw the storyboard on my running page, mark my leanings as suggested, and wait for my approval before you change code.',
    outroOpenOnly: 'Draw the storyboard on my running page and wait for my approval before you change code.',
  },
  ko: {
    intro: (title, file) => `picky-eater 스킬로 이 프로젝트의 ${title} 화면(${file})을 다듬어 줘.`,
    introMany: 'picky-eater 스킬로 이 프로젝트의 아래 화면들을 차례로 다듬어 줘.',
    heading: (title, file) => `${title} 화면 (${file}):`,
    leaning: '웹에서 먼저 골라 봤어. 이쪽이 마음에 들어:',
    open: '아직 못 정한 곳은 옵션을 보여 줘:',
    keep: '지금 그대로 두기',
    outro: '실행 중인 내 페이지 위에 스토리보드를 그려 줘. 내가 고른 안은 추천으로 표시하고, 승인하기 전에는 코드를 바꾸지 마.',
    outroOpenOnly: '실행 중인 내 페이지 위에 스토리보드를 그려 줘. 승인하기 전에는 코드를 바꾸지 마.',
  },
};

// "A bar that stays" reads on as "a bar that stays"; "SMS first" keeps its capitals.
const lowerFirst = (text) => (/^[A-Z](?![A-Z])/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text);

/** The lines about one screen: what was picked there and what is still open. Returns whether anything was picked. */
function body(out, analysis, choices, t, lang) {
  const picked = analysis.areas.filter((a) => choices[a.id]);
  const open = analysis.areas.filter((a) => !choices[a.id]);
  if (picked.length) {
    out.push(t.leaning);
    for (const area of picked) {
      const option = area.options.find((o) => o.id === choices[area.id]);
      const what = option.keep ? t.keep : `${lang === 'ko' ? option.label : lowerFirst(option.label)}${option.pattern ? ` (${option.pattern})` : ''}`;
      out.push(`- ${area.label}: ${what}`);
    }
    out.push('');
  }
  if (open.length) {
    out.push(t.open);
    for (const area of open) out.push(`- ${area.label}`);
    out.push('');
  }
  return picked.length > 0;
}

export function buildPrompt(analysis, choices, lang) {
  const t = TEXT[lang] ?? TEXT.en;
  const out = [t.intro(analysis.screen.title, analysis.screen.file), ''];
  const picked = body(out, analysis, choices, t, lang);
  out.push(picked ? t.outro : t.outroOpenOnly);
  return out.join('\n');
}

/**
 * One prompt for several screens of a project, `[{ analysis, choices }]`: what was picked on
 * each, under its name. One screen reads as `buildPrompt` writes it; none gives an empty prompt.
 */
export function buildProjectPrompt(screens, lang) {
  if (!screens.length) return '';
  if (screens.length === 1) return buildPrompt(screens[0].analysis, screens[0].choices, lang);
  const t = TEXT[lang] ?? TEXT.en;
  const out = [t.introMany, ''];
  let picked = false;
  for (const { analysis, choices } of screens) {
    out.push(t.heading(analysis.screen.title, analysis.screen.file));
    if (body(out, analysis, choices, t, lang)) picked = true;
  }
  out.push(picked ? t.outro : t.outroOpenOnly);
  return out.join('\n');
}

/** What a pick changes, as the lines that carry a choice: `{ removed: [], added: [] }`. */
export function diffPrompt(before, after) {
  const pick = (text) => text.split('\n').filter((line) => line.startsWith('- '));
  const a = pick(before);
  const b = pick(after);
  const clean = (line) => line.replace(/^- /, '');
  return { removed: a.filter((line) => !b.includes(line)).map(clean), added: b.filter((line) => !a.includes(line)).map(clean) };
}

function operations(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { ops.push(['same', a[i]]); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { ops.push(['remove', a[i]]); i += 1; }
    else { ops.push(['add', b[j]]); j += 1; }
  }
  while (i < a.length) { ops.push(['remove', a[i]]); i += 1; }
  while (j < b.length) { ops.push(['add', b[j]]); j += 1; }
  return ops;
}

/**
 * Carries the change from `before` to `after` (two generated prompts) over to `edited`, the text
 * the person has in front of them. Lines they wrote or changed stay where they are.
 */
export function mergePrompt(edited, before, after) {
  if (edited === before) return after;
  const mine = edited.split('\n');
  const out = [];
  let at = 0;
  const find = (line) => {
    // An empty line matches almost anywhere, so it is only looked for close by.
    const limit = line.trim() ? mine.length : Math.min(mine.length, at + 2);
    for (let k = at; k < limit; k += 1) if (mine[k] === line) return k;
    return -1;
  };
  for (const [kind, line] of operations(before.split('\n'), after.split('\n'))) {
    if (kind === 'add') {
      out.push(line);
      continue;
    }
    const k = find(line);
    if (k < 0) continue;
    out.push(...mine.slice(at, k));
    if (kind === 'same') out.push(line);
    at = k + 1;
  }
  out.push(...mine.slice(at));
  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}
