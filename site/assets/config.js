// Where the analysis runs. GitHub Pages serves only files, so the page calls the Vercel
// deployment of this repository; on that deployment and on a local server the path is relative.
const VERCEL = 'https://pe-www.vercel.app';

export const API_BASE = location.hostname.endsWith('github.io') ? VERCEL : '';
