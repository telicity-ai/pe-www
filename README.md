# pe-www

The landing page of [picky-eater](https://github.com/telicity-ai/picky-eater), with a preview
that reads a public GitHub repository and lets a visitor try the skill in the browser: pick
options on a wireframe of one of their screens, and take the result away as a prompt.

- Page: <https://telicity-ai.github.io/pe-www/> (GitHub Pages, the `site/` folder)
- Analysis: `api/analyze.js`, a Vercel function that asks Upstage Solar for a storyboard

## How the preview works

```
browser ── GitHub API ──▶ file tree, package.json        (the visitor's own rate limit)
   │        finds the stack and the files that are screens
   │
   └─ GET /api/analyze?repo=…&ref=…&path=…&rel=… ──▶ Vercel function
                                                       │ fetches those files from raw.githubusercontent.com
                                                       │ asks Solar (solar-pro4) for a storyboard, as JSON
                                                       ▼ checks and bounds the answer
   draws the wireframe, the dots and the options ◀── { screen, page, areas }
   writes the prompt as options are picked
```

- **A storyboard** is a wireframe of the screen as it is today (`page`) and three to five
  `areas` with two to four options each. The first option of an area is what the code does now;
  the others name a pattern of picky-eater's catalog. The format is in `api/_lib/prompt.js`.
- **The function is given file names, not text.** It fetches the files itself, so it cannot be
  used to send arbitrary text to the model. The answer must match a JSON Schema, and
  `api/_lib/normalize.js` bounds every string and drops what it does not know. The page draws
  the result as text, never as markup.
- **The same files give the same answer**, so successful answers are cached by Vercel's CDN.
- **The sample** on the page (`site/assets/sample.js`) is written by hand in the same format.

## Develop

Node.js 20 or newer. There is nothing to install.

```sh
npm run dev -- --mock   # http://127.0.0.1:4321, the analysis answers with a canned storyboard
UPSTAGE_API_KEY=… npm run dev   # the real analysis
npm test
```

The pattern catalog in `api/_lib/catalog.js` is generated from a picky-eater checkout:

```sh
npm run sync-catalog -- ../picky-eater
```

## Deploy

| | |
|---|---|
| Page | Every push to `main` runs the tests and publishes `site/` to GitHub Pages (`.github/workflows/pages.yml`) |
| Analysis | `vercel deploy --prod` from this folder. The page on github.io calls the address in `site/assets/config.js` |

Environment variables of the Vercel project:

| Name | |
|---|---|
| `UPSTAGE_API_KEY` | Required. Without it the function answers `not_configured` and the page offers the sample |
| `SOLAR_MODEL` | Optional. Default `solar-pro4` |
| `ALLOWED_ORIGINS` | Optional. More origins that may call the function, separated by commas. `https://telicity-ai.github.io` and localhost are always allowed |

## Languages

English is the default. Korean is chosen with the switch in the header or `?lang=ko`. Every
string of the interface is in `site/assets/i18n.js`.

## License

[MIT](LICENSE)
