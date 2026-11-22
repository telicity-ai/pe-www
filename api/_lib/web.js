// Fetching a page that a visitor names. The address comes from anyone, so nothing but public
// web pages may be reached with it: no address inside a private network, no other port, no
// other scheme, and every redirect is looked at again.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class WebError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

/** True for an address that is not one of the public internet. */
export function privateAddress(ip) {
  if (isIP(ip) === 4) return privateV4(ip);
  const lower = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]);
  return lower === '::' || lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith('ff') || lower.startsWith('64:ff9b') || lower.startsWith('2001:db8');
}

/** The address as a URL that may be fetched, or a WebError. Typed without a scheme, it is taken as https. */
export function publicUrl(input) {
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    throw new WebError(400, 'bad_url', 'That is not a web address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new WebError(400, 'bad_url', 'Only http and https addresses are read');
  if (url.username || url.password) throw new WebError(400, 'bad_url', 'An address with a login in it is not read');
  if (url.port && url.port !== '80' && url.port !== '443') throw new WebError(400, 'bad_url', 'Only the usual ports are read');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? privateAddress(host) : !/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/i.test(host) || /\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/i.test(host)) {
    throw new WebError(400, 'bad_url', 'That is not a public web address');
  }
  url.hash = '';
  return url;
}

async function resolvesPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return;
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new WebError(502, 'unreachable', 'That address does not resolve');
  }
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) throw new WebError(400, 'bad_url', 'That is not a public web address');
}

/**
 * Fetches a public web address: `{ url, type, text }`, with `url` where it ended up after
 * redirects. Throws a WebError. `types` are the content types that are taken.
 */
export async function fetchPublic(input, { maxBytes, ms = 10_000, types = /html/i, accept = 'text/html,application/xhtml+xml' } = {}) {
  let url = input instanceof URL ? input : publicUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    for (let hop = 0; hop < 5; hop += 1) {
      await resolvesPublic(url);
      let response;
      try {
        response = await fetch(url, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { accept, 'accept-language': 'en,*;q=0.5', 'user-agent': 'Mozilla/5.0 (compatible; page-preview/1.0)' },
        });
      } catch {
        throw new WebError(502, 'unreachable', 'The page could not be reached');
      }
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        await response.body?.cancel().catch(() => {});
        try {
          url = publicUrl(new URL(response.headers.get('location'), url).href);
        } catch {
          throw new WebError(502, 'unreachable', 'The page leads somewhere that is not read');
        }
        continue;
      }
      if (!response.ok) throw new WebError(response.status === 404 ? 404 : 502, response.status === 404 ? 'page_not_found' : 'unreachable', `The site answered ${response.status}`);
      const type = response.headers.get('content-type') ?? '';
      if (!types.test(type)) throw new WebError(415, 'not_a_page', 'That address is not a web page');
      // Read up to the limit and no further.
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) {
          controller.abort();
          throw new WebError(413, 'too_large', 'The page is too large');
        }
        chunks.push(chunk);
      }
      return { url, type, text: new TextDecoder().decode(Buffer.concat(chunks)) };
    }
    throw new WebError(502, 'unreachable', 'The page redirects too often');
  } catch (error) {
    if (error instanceof WebError) throw error;
    throw new WebError(502, 'unreachable', error?.name === 'AbortError' ? 'The page took too long' : 'The page could not be read');
  } finally {
    clearTimeout(timer);
  }
}
