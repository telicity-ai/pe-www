// Icons of the icon libraries that projects use, by name. An analysis names an icon instead of
// drawing it (the model would spend most of its time on coordinates, and get them wrong); the
// drawings come from Iconify, which carries the common sets under one address.

const API = 'https://api.iconify.design';
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const known = new Map(); // "set:name" → { body, width, height }, or null when there is no such icon
const asked = new Set();

/** undefined while it is not known, null when the icon does not exist. */
export const iconOf = (key) => known.get(key);

/** The icons named in a piece of markup that have not been asked for yet. */
export function iconsIn(html) {
  const keys = new Set();
  for (const match of html.matchAll(/data-icon\s*=\s*["']([^"']+)["']/g)) {
    const key = match[1].trim().toLowerCase();
    if (!asked.has(key)) keys.add(key);
  }
  return [...keys];
}

/** Fetches the named icons. Resolves to true when at least one became known. */
export async function loadIcons(keys) {
  const sets = new Map();
  for (const key of keys) {
    if (asked.has(key)) continue;
    asked.add(key);
    const [set, name, more] = key.split(':');
    if (more !== undefined || !NAME.test(set ?? '') || !NAME.test(name ?? '') || set === 'custom') {
      known.set(key, null);
      continue;
    }
    if (!sets.has(set)) sets.set(set, []);
    sets.get(set).push(name);
  }
  if (!sets.size) return false;
  await Promise.all([...sets].map(async ([set, names]) => {
    let data = null;
    try {
      const response = await fetch(`${API}/${set}.json?icons=${names.join(',')}`);
      if (response.ok) data = await response.json();
    } catch { /* the icons stay unknown */ }
    for (const name of names) {
      const icon = data?.icons?.[name] ?? data?.icons?.[data?.aliases?.[name]?.parent];
      known.set(`${set}:${name}`, icon?.body ? { body: icon.body, width: icon.width ?? data.width ?? 24, height: icon.height ?? data.height ?? 24 } : null);
    }
  }));
  return true;
}
