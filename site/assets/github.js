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
const SKIP_FILE = /(\.(test|spec|stories|story|d)\.[a-z]+$)|((^|\/)(_app|_document|_error|layout|\+layout|\+error|error|loading|not-found|404|500|middleware|main|index\.d)\.[a-z.]+$)/i;
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
  points += Math.min(14, size / 1500);
  points -= path.split('/').length * 0.8;
  if (size < 250) points -= 30;
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
 * `onStep(name)` is called with "tree", "stack" and "screens" as each begins.
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

  onStep('stack');
  const manifests = paths.filter((p) => /(^|\/)package\.json$/.test(p) && !SKIP_DIR.test(p)).sort((a, b) => a.split('/').length - b.split('/').length).slice(0, 3);
  const packages = (await Promise.all(manifests.map((p) => rawFile(repo, p)))).map((text) => {
    try { return JSON.parse(text); } catch { return null; }
  });
  const stack = stackFrom(packages, paths);

  onStep('screens');
  const ranked = files.map((f) => ({ path: f.path, size: f.size ?? 0, points: score(f.path, f.size ?? 0) })).filter((f) => f.points > 0).sort((a, b) => b.points - a.points);
  const strong = ranked.filter((f) => f.points >= 38);
  const chosen = (strong.length ? strong : ranked).filter((f) => f.size <= 120_000).slice(0, 8);
  if (!chosen.length) throw new RepoError('no_screens');

  const seen = new Map();
  const screens = chosen.map((f) => {
    let title = screenTitle(f.path);
    const n = (seen.get(title) ?? 0) + 1;
    seen.set(title, n);
    if (n > 1) title = `${title} ${n}`;
    return { id: f.path, path: f.path, title };
  });
  return { repo, stack, screens, paths, treeSha: tree.sha, truncated: Boolean(tree.truncated) };
}

const TRY_EXT = ['', '.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.astro', '.css', '.scss', '.module.css', '.module.scss', '/index.tsx', '/index.jsx', '/index.ts', '/index.js', '/index.vue'];
const RELATED_OK = /\.(tsx|jsx|vue|svelte|astro|css|scss|less|html)$/i;

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

/** The files a screen draws with: its styles and the components it imports, most useful first. */
export async function relatedFiles(scan, path, max = 5) {
  const source = await rawFile(scan.repo, path);
  if (!source) return [];
  const pathSet = new Set(scan.paths);
  const specs = new Set();
  for (const m of source.matchAll(/(?:from\s+|import\s+|import\(\s*|require\(\s*)['"]([^'"\n]+)['"]/g)) specs.add(m[1]);
  for (const m of source.matchAll(/(?:href|src|templateUrl|styleUrl)\s*[=:]\s*['"]([^'"\n]+\.(?:css|scss|html))['"]/g)) specs.add(m[1].startsWith('.') || m[1].startsWith('/') ? m[1].replace(/^\//, './') : `./${m[1]}`);
  const found = [];
  for (const spec of specs) {
    const hit = resolve(path, spec, pathSet, scan.paths);
    if (hit && hit !== path && RELATED_OK.test(hit) && !found.includes(hit)) found.push(hit);
  }
  // A stylesheet with the same name, even when it is not imported from the file itself.
  const sibling = path.replace(/\.[A-Za-z0-9]+$/, '');
  for (const ext of ['.css', '.module.css', '.scss']) if (pathSet.has(sibling + ext) && !found.includes(sibling + ext)) found.push(sibling + ext);
  const rank = (p) => (/\.(css|scss|less)$/.test(p) ? 1 : 0) + (/(^|\/)(ui|icons?)\//.test(p) ? 2 : 0);
  return found.sort((a, b) => rank(a) - rank(b)).slice(0, max);
}
