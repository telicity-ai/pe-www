// Reads a public repository from the visitor's browser: the file tree, the stack, and which
// files are screens. Only GitHub's public API and raw file host are used.

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

export class RepoError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Accepts `owner/name`, a github.com address, and an address of a folder inside a repository. */
export function parseRepo(input) {
  let text = String(input ?? '').trim();
  if (!text) return null;
  text = text.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/^\/+/, '').replace(/[?#].*$/, '');
  const parts = text.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
  const repo = { owner, name, ref: null, sub: '' };
  if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) {
    repo.ref = parts[3];
    repo.sub = parts.slice(4).join('/').replace(/\/[^/]+\.[A-Za-z0-9]+$/, (m) => (parts[2] === 'blob' ? '' : m));
  }
  return repo;
}

async function api(path) {
  let response;
  try {
    response = await fetch(`${API}${path}`, { headers: { accept: 'application/vnd.github+json' } });
  } catch {
    throw new RepoError('network');
  }
  if (response.status === 404) throw new RepoError('not_found');
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get('x-ratelimit-reset'));
    throw new RepoError('rate_limited', reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null);
  }
  if (!response.ok) throw new RepoError('github');
  return response.json();
}

export async function rawFile(repo, path) {
  const url = `${RAW}/${repo.owner}/${repo.name}/${[...repo.ref.split('/'), ...path.split('/')].map(encodeURIComponent).join('/')}`;
  try {
    const response = await fetch(url);
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.git|storybook-static|__tests__|__mocks__|tests?|e2e|cypress|playwright|fixtures?|\.storybook)\//;
const SKIP_FILE = /(\.(test|spec|stories|story|d)\.[a-z]+$)|((^|\/)(_app|_document|_error|__root|_layout|layout|\+layout|\+error|error|loading|not-found|404|500|middleware|main|index\.d)\.[a-z.]+$)/i;
const UI_FILE = /\.(tsx|jsx|vue|svelte|astro)$/i;

function score(path, size) {
  if (SKIP_DIR.test(path) || SKIP_FILE.test(path)) return 0;
  let points = 0;
  if (/(^|\/)app\/(.*\/)?page\.(tsx|jsx|js|ts|mdx)$/.test(path)) points = 100;
  else if (/(^|\/)routes\/(.*\/)?\+page\.svelte$/.test(path)) points = 96;
  else if (/(^|\/)pages\/(?!api\/).+\.(tsx|jsx|vue|astro|svelte|js)$/.test(path)) points = 90;
  else if (/(^|\/)(views|screens|routes)\/.+\.(tsx|jsx|vue|svelte)$/.test(path)) points = 85;
  else if (/(Page|Screen|View)\.(tsx|jsx|vue|svelte)$/.test(path)) points = 72;
  else if (/\.component\.html$/.test(path)) points = 60;
  else if (/(^|\/)index\.html$/.test(path) && !/(^|\/)public\//.test(path)) points = 52;
  else if (/\.html$/.test(path) && !/(^|\/)public\//.test(path)) points = 44;
  else if (/(^|\/)App\.(tsx|jsx|vue|svelte)$/.test(path)) points = 42;
  else if (UI_FILE.test(path)) points = 20;
  if (!points) return 0;
  if (/(^|\/)(examples?|demos?|samples?|playground|docs?|templates?)\//i.test(path)) points -= 30;
  // The product is what people come to improve; its marketing site comes after it.
  if (/(^|\/)(marketing|website|landing|www|site|blog|storybook)\//i.test(path)) points -= 25;
  points += Math.min(14, size / 1500);
  points -= path.split('/').length * 0.8;
  if (size < 60) points -= 30;
  return points;
}

const SUFFIX = /(Page|Screen|View|Route|\.component|\.page)$/i;
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').trim();
const titleCase = (text) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());

function screenTitle(path) {
  const parts = path.split('/');
  const file = parts.pop().replace(/\.[A-Za-z0-9]+$/, '').replace(/\.component$/, '');
  if (/^(page|\+page|index)$/i.test(file)) {
    const folders = parts.filter((p) => !/^\(.*\)$/.test(p) && !/^(app|src|pages|routes|views|screens)$/i.test(p));
    const last = folders.pop();
    if (!last) return 'Home';
    const parent = /^\[.*\]$/.test(last) ? folders.pop() : null;
    if (/^\[.*\]$/.test(last)) return titleCase(words(parent ? `${parent} detail` : `${last.replace(/[[\].]/g, '')} page`));
    return titleCase(words(last));
  }
  if (file.includes('.') && !/\s/.test(file)) {
    // A route named by its address: "_chat.settings.general" is the General screen of Settings.
    const named = file.split('.').filter((part) => part && !/^[_$]/.test(part) && part !== 'index');
    if (named.length) return titleCase(words(named.slice(-2).join(' ')));
    return titleCase(words(file.replace(/^[_$]+/, '').split('.')[0] || file));
  }
  return titleCase(words(file.replace(SUFFIX, '') || file));
}

const DEPENDENCIES = [
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'],
  ['react-router', 'React Router'], ['@angular/core', 'Angular'], ['solid-js', 'Solid'], ['preact', 'Preact'],
  ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['vite', 'Vite'], ['tailwindcss', 'Tailwind CSS'],
  ['@mui/material', 'MUI'], ['@chakra-ui/react', 'Chakra UI'], ['antd', 'Ant Design'], ['styled-components', 'styled-components'],
  ['@emotion/react', 'Emotion'], ['@radix-ui/react-slot', 'Radix UI'], ['typescript', 'TypeScript'],
];
const IMPLIED = { 'Next.js': 'React', Remix: 'React', 'React Router': 'React', Nuxt: 'Vue', SvelteKit: 'Svelte' };

function stackFrom(packages, paths) {
  const names = new Set();
  for (const pkg of packages) {
    for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) Object.keys(pkg?.[key] ?? {}).forEach((n) => names.add(n));
  }
  const stack = [];
  for (const [dependency, label] of DEPENDENCIES) if (names.has(dependency) && !stack.includes(label)) stack.push(label);
  const implied = new Set(stack.map((label) => IMPLIED[label]).filter(Boolean));
  let out = stack.filter((label) => !implied.has(label));
  if (!out.includes('TypeScript') && paths.some((p) => /(^|\/)tsconfig\.json$/.test(p))) out.push('TypeScript');
  if (!out.includes('Tailwind CSS') && paths.some((p) => /(^|\/)tailwind\.config\.[a-z]+$/.test(p))) out.push('Tailwind CSS');
  if (!out.length && paths.some((p) => /\.html$/.test(p))) out = ['HTML', 'CSS'];
  return out.slice(0, 5);
}

/**
 * Looks at a repository and returns what can be analyzed.
 * `onStep(name)` is called with "tree", "screens" and "stack" as each begins.
 */
export async function scanRepo(input, onStep = () => {}) {
  const repo = parseRepo(input);
  if (!repo) throw new RepoError('bad_input');

  onStep('tree');
  const info = await api(`/repos/${repo.owner}/${repo.name}`);
  repo.owner = info.owner?.login ?? repo.owner;
  repo.name = info.name ?? repo.name;
  let tree;
  try {
    repo.ref ??= info.default_branch;
    tree = await api(`/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`);
  } catch (error) {
    // An address such as /tree/feature/x names a branch with a slash; fall back to the default one.
    if (error.code !== 'not_found' || repo.ref === info.default_branch) throw error;
    repo.ref = info.default_branch;
    repo.sub = '';
    tree = await api(`/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.ref)}?recursive=1`);
  }
  const prefix = repo.sub ? `${repo.sub.replace(/\/+$/, '')}/` : '';
  const files = (tree.tree ?? []).filter((e) => e.type === 'blob' && (!prefix || e.path.startsWith(prefix)));
  if (!files.length) throw new RepoError('empty');
  const paths = files.map((f) => f.path);

  onStep('screens');
  // A route that other routes are named after ("_chat.settings" for "_chat.settings.general") wraps them: it is not a screen.
  const wraps = (path) => {
    const stem = path.replace(/\.[A-Za-z0-9]+$/, '');
    return /(^|\/)(routes|pages|app)\//.test(path) && paths.some((other) => other !== path && other.startsWith(`${stem}.`));
  };
  const ranked = files.map((f) => ({ path: f.path, size: f.size ?? 0, points: score(f.path, f.size ?? 0) }))
    .filter((f) => f.points > 0 && !wraps(f.path)).sort((a, b) => b.points - a.points);
  const strong = ranked.filter((f) => f.points >= 38);
  const chosen = (strong.length ? strong : ranked).filter((f) => f.size <= 200_000).slice(0, 8);
  if (!chosen.length) throw new RepoError('no_screens');

  onStep('stack');
  // The stack is that of the package the first screens live in, not of the repository's root.
  const pathSet = new Set(paths);
  const homes = [...new Set(chosen.slice(0, 3).map((f) => packageRoot(f.path, pathSet, '')))];
  const manifests = [...new Set([...homes.map((home) => (home ? `${home}/package.json` : 'package.json')), 'package.json'])].filter((p) => pathSet.has(p)).slice(0, 3);
  const packages = (await Promise.all(manifests.map((p) => rawFile(repo, p)))).map((text) => {
    try { return JSON.parse(text); } catch { return null; }
  });
  const stack = stackFrom(packages, homes[0] ? paths.filter((p) => p.startsWith(`${homes[0]}/`)) : paths);

  const seen = new Map();
  const screens = chosen.map((f) => {
    let title = screenTitle(f.path);
    const n = (seen.get(title) ?? 0) + 1;
    seen.set(title, n);
    if (n > 1) title = `${title} ${n}`;
    return { id: f.path, path: f.path, title };
  });
  const sizes = new Map(files.map((f) => [f.path, f.size ?? 0]));
  return { repo, stack, screens, paths, sizes, treeSha: tree.sha, truncated: Boolean(tree.truncated) };
}

const TRY_EXT = ['', '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro', '.css', '.scss', '.module.css', '.module.scss', '/index.tsx', '/index.jsx', '/index.ts', '/index.js', '/index.vue'];
const UI = /\.(tsx|jsx|vue|svelte|astro)$/i;
const SHEET = /\.css$/i;
const CONTAINER = /(layout|container|shell|page|column|wrapper|scaffold|inset|frame)[^/]*\.(tsx|jsx|vue|svelte|astro)$/i;
const GLOBAL_SHEET = /(^|\/)(index|globals?|app|main|styles?|tailwind|theme|tokens|variables|base|reset)\.css$/i;
const ENTRIES = ['src/main.tsx', 'src/main.ts', 'src/main.jsx', 'src/main.js', 'src/index.tsx', 'src/index.jsx', 'src/index.js', 'app/layout.tsx', 'app/layout.jsx', 'src/app/layout.tsx', 'src/app/layout.jsx', 'pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js', 'src/pages/_app.tsx', 'app/root.tsx', 'src/root.tsx', 'src/routes/+layout.svelte', 'src/App.vue', 'app/app.vue', 'app.vue', 'src/layouts/Layout.astro'];

function resolve(from, spec, pathSet, paths) {
  if (spec.startsWith('.')) {
    const stack = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '..') stack.pop();
      else if (part !== '.') stack.push(part);
    }
    const base = stack.join('/');
    for (const ext of TRY_EXT) if (pathSet.has(base + ext)) return base + ext;
    return null;
  }
  // "@/components/Card", "~/components/Card", "$lib/Card", "src/components/Card"
  const alias = spec.match(/^(@|~|\$lib|src|app)\/(.+)$/);
  if (!alias) return null;
  for (const ext of TRY_EXT) {
    const tail = `/${alias[2]}${ext}`;
    const hit = paths.find((p) => `/${p}`.endsWith(tail) && !SKIP_DIR.test(p));
    if (hit) return hit;
  }
  return null;
}

function importsOf(from, source, pathSet, paths) {
  const specs = new Set();
  for (const m of source.matchAll(/(?:from\s+|import\s+|import\(\s*|require\(\s*)['"]([^'"\n]+)['"]/g)) specs.add(m[1]);
  for (const m of source.matchAll(/(?:href|src|templateUrl|styleUrl)\s*[=:]\s*['"]([^'"\n]+\.(?:css|html))['"]/g)) specs.add(/^[./]/.test(m[1]) ? m[1].replace(/^\//, './') : `./${m[1]}`);
  const found = [];
  for (const spec of specs) {
    const hit = resolve(from, spec, pathSet, paths);
    if (hit && hit !== from && !found.includes(hit)) found.push(hit);
  }
  return found;
}

/** The files that wrap a screen: a parent route, a layout in its folder or the folders above. */
function layoutsOf(path, pathSet) {
  const parts = path.split('/');
  const file = parts.pop();
  const ext = file.slice(file.lastIndexOf('.'));
  const name = file.slice(0, -ext.length);
  const found = [];
  const segments = name.split('.');
  for (let k = segments.length - 1; k >= 1 && found.length < 2; k -= 1) {
    const parent = `${parts.join('/')}/${segments.slice(0, k).join('.')}${ext}`;
    if (pathSet.has(parent)) found.push(parent);
  }
  for (let up = 0; up < 4 && found.length < 3; up += 1) {
    const dir = parts.slice(0, parts.length - up).join('/');
    for (const layout of ['layout.tsx', 'layout.jsx', 'layout.js', '+layout.svelte', '_layout.tsx']) {
      const candidate = dir ? `${dir}/${layout}` : layout;
      if (pathSet.has(candidate) && candidate !== path && !found.includes(candidate)) found.push(candidate);
    }
  }
  return found;
}

function packageRoot(path, pathSet, fallback) {
  const parts = path.split('/').slice(0, -1);
  while (parts.length) {
    if (pathSet.has(`${parts.join('/')}/package.json`)) return parts.join('/');
    parts.pop();
  }
  return pathSet.has('package.json') ? '' : fallback;
}

/** The object literal that follows `name:` in a configuration file, without its outer braces. */
function objectAfter(source, name) {
  const start = source.search(new RegExp(`\\b${name}\\s*:\\s*\\{`));
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (!depth) return source.slice(open + 1, i);
    }
  }
  return null;
}

/** `key: "value"` pairs of an object literal, nested ones joined with "-"; `DEFAULT` names its parent. */
function entries(body, prefix = []) {
  const found = [];
  let rest = body;
  for (let guard = 0; guard < 400; guard += 1) {
    const key = rest.match(/^[\s,]*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*[\s,]*(["']?)([\w-]+)\1\s*:\s*/);
    if (!key) break;
    rest = rest.slice(key[0].length);
    const path = key[2] === 'DEFAULT' ? prefix : [...prefix, key[2]];
    if (rest[0] === '{') {
      let depth = 0;
      let end = 0;
      for (; end < rest.length; end += 1) {
        if (rest[end] === '{') depth += 1;
        else if (rest[end] === '}' && !(depth -= 1)) break;
      }
      found.push(...entries(rest.slice(1, end), path));
      rest = rest.slice(end + 1);
      continue;
    }
    const text = rest.match(/^(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/);
    if (text) {
      found.push([path, text[2]]);
      rest = rest.slice(text[0].length);
      continue;
    }
    // Anything else (a function, a spread, a reference): skip to the next entry on this level.
    let depth = 0;
    let end = 0;
    for (; end < rest.length; end += 1) {
      if ('{[('.includes(rest[end])) depth += 1;
      else if ('}])'.includes(rest[end])) depth -= 1;
      else if (rest[end] === ',' && depth <= 0) break;
    }
    rest = rest.slice(end + 1);
  }
  return found;
}

/**
 * Tailwind 3 keeps a project's colors and radii in tailwind.config; Tailwind 4, which draws the
 * mockup, wants them as CSS. This writes the plain ones over (those given as strings).
 */
export function themeFromConfig(source) {
  const lines = [];
  const add = (name, prefix) => {
    const body = objectAfter(source, name);
    if (!body) return;
    for (const [path, value] of entries(body)) {
      if (!path.length || /[<>{};]/.test(value) || value.includes('<alpha-value>')) continue;
      lines.push(`  --${prefix}-${path.join('-')}: ${value};`);
    }
  };
  add('colors', 'color');
  add('borderRadius', 'radius');
  const dark = /darkMode\s*:\s*\[?\s*["']class["']/.test(source) ? '@custom-variant dark (&:where(.dark, .dark *));\n' : '';
  return lines.length || dark ? `${dark}@theme inline {\n${[...new Set(lines)].join('\n')}\n}` : '';
}

// A section component that puts a heading and a single wrapper around {children}
// defines two grid cells even when the caller supplies a whole list of rows.
export function sectionGrids(sources) {
  const grids = new Map();
  const template = /<section\s+className\s*=\s*["']([^"'<>]+)["']\s*>\s*<(h[1-6])\b[^>]*>\s*\{\s*[\w.]+\s*\}\s*<\/\2>\s*<div\s+className\s*=\s*["']([^"'<>]+)["']\s*>\s*\{\s*(?:props\.)?children\s*\}\s*<\/div>\s*<\/section>/g;
  for (const source of sources) {
    if (!source) continue;
    for (const [, outer, heading, bodyClass] of source.matchAll(template)) {
      const classes = outer.trim().split(/\s+/);
      if (!classes.includes('grid') || !classes.some((c) => /(?:^|:)grid-cols-/.test(c))) continue;
      const key = `${classes.slice().sort().join(' ')}|${heading}`;
      if (!grids.has(key)) grids.set(key, { classes, heading, bodyClass });
      else if (grids.get(key)?.bodyClass !== bodyClass) grids.set(key, null);
    }
  }
  return [...grids.values()].filter(Boolean);
}

// Full thread views render these three components together. Their optional banners
// and secondary panes are not a substitute for the conversation itself.
export function conversationParts(source) {
  const header = source.match(/<(ChatHeader|ThreadHeader)\b/);
  const history = source.match(/<(ThreadTimeline|MessagesTimeline|MessageList|ChatTimeline)\b/);
  const composer = source.match(/<(ChatComposer|MessageComposer)\b/);
  return header && history && composer ? [header[1], history[1], composer[1]] : [];
}

/**
 * Everything a screen is drawn with.
 *   related: the components it renders (its own imports, then theirs) and the layouts around it;
 *   styles:  what the model is shown of the project's styling;
 *   assets:  the stylesheets themselves, for the frame that shows the mockup.
 */
export async function collectFiles(scan, path) {
  const pathSet = new Set(scan.paths);
  const size = (p) => scan.sizes.get(p) ?? 0;
  const cache = new Map();
  const read = (p) => {
    if (!cache.has(p)) cache.set(p, rawFile(scan.repo, p));
    return cache.get(p);
  };
  const empty = { related: [], styles: [], assets: { css: [], tailwind: scan.stack.includes('Tailwind CSS'), dark: false } };
  const main = await read(path);
  if (!main) return empty;

  const first = importsOf(path, main, pathSet, scan.paths);
  const conversation = conversationParts(main);
  const conversationFiles = first.filter((p) => conversation.includes(p.split('/').pop().split('.')[0]));
  const components = first.filter((p) => UI.test(p)).sort((a, b) => size(b) - size(a)).slice(0, 8);
  const layouts = layoutsOf(path, pathSet);
  // A route file is often three lines around one component: what that component renders is in its own imports.
  const opened = [...layouts.slice(0, 1), ...components.slice(0, 4)];
  const sources = await Promise.all(opened.map(read));
  const second = new Set();
  sources.forEach((source, i) => {
    if (source) for (const hit of importsOf(opened[i], source, pathSet, scan.paths)) if (UI.test(hit)) second.add(hit);
  });
  const rank = (p) => (/(^|\/)ui\//.test(p) ? 0 : CONTAINER.test(p.split('/').pop()) ? 1 : 2);
  const deeper = [...second].sort((a, b) => rank(a) - rank(b) || size(a) - size(b));
  // What centers a screen and sets its width is often a small container component a level further
  // down (a page container, a column): without it the model guesses, and the page leans to one side.
  const holders = [...second].filter((p) => CONTAINER.test(p.split('/').pop()) && size(p) < 120_000).slice(0, 6);
  const holderSources = await Promise.all(holders.map(read));
  const containers = new Set([...first, ...second].filter((p) => CONTAINER.test(p.split('/').pop())));
  holderSources.forEach((source, i) => {
    if (source) for (const hit of importsOf(holders[i], source, pathSet, scan.paths)) if (UI.test(hit) && CONTAINER.test(hit.split('/').pop())) containers.add(hit);
  });
  const small = [...containers].filter((p) => size(p) < 20_000).sort((a, b) => size(a) - size(b));

  const related = [];
  let budget = 260_000;
  for (const candidate of [...layouts, ...conversationFiles, ...small, ...components, ...deeper]) {
    if (candidate === path || related.includes(candidate) || related.length >= 15) continue;
    const cost = Math.min(size(candidate), 100_000);
    if (cost > budget) continue;
    related.push(candidate);
    budget -= cost;
  }

  const root = packageRoot(path, pathSet, scan.repo.sub ?? '');
  const inRoot = (p) => !root || p.startsWith(`${root}/`);
  const entries = ENTRIES.map((e) => (root ? `${root}/${e}` : e)).filter((e) => pathSet.has(e)).slice(0, 3);
  const entrySources = await Promise.all(entries.map(read));
  const fromEntries = entrySources.flatMap((source, i) => (source ? importsOf(entries[i], source, pathSet, scan.paths) : [])).filter((p) => SHEET.test(p));
  const named = scan.paths.filter((p) => inRoot(p) && GLOBAL_SHEET.test(p) && !SKIP_DIR.test(p) && !/(^|\/)public\//.test(p))
    .sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 4);
  const fromScreen = [[path, main], ...opened.map((p, i) => [p, sources[i]])]
    .flatMap(([from, source]) => (source ? importsOf(from, source, pathSet, scan.paths) : [])).filter((p) => SHEET.test(p));
  const sheets = [...new Set([...fromEntries, ...named, ...fromScreen])].filter((p) => size(p) < 400_000).slice(0, 8);
  const css = (await Promise.all(sheets.map(read))).filter(Boolean);

  const config = scan.paths.find((p) => /(^|\/)tailwind\.config\.[a-z]+$/.test(p) && inRoot(p)) ?? scan.paths.find((p) => /^tailwind\.config\.[a-z]+$/.test(p));
  if (config) {
    const theme = themeFromConfig((await read(config)) ?? '');
    if (theme) css.push(theme);
  }
  const all = css.join('\n');
  return {
    related,
    styles: [...sheets.slice(0, 3), ...(config ? [config] : [])],
    assets: {
      css,
      conversation: conversation.length > 0,
      sectionGrids: sectionGrids([main, ...sources, ...holderSources]),
      tailwind: scan.stack.includes('Tailwind CSS') || Boolean(config) || /@tailwind\b|@import\s+["']tailwindcss/.test(all),
      dark: /(^|[\s,{}(])\.dark\b|\[data-theme=["']?dark/.test(all),
    },
  };
}
