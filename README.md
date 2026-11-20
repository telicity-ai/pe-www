# pe-www

The landing page of [picky-eater](https://github.com/telicity-ai/picky-eater), with a preview
that reads a public GitHub repository and lets a visitor try the skill in the browser: pick
options on a wireframe of one of their screens, and take the result away as a prompt.

- Page: <https://telicity-ai.github.io/pe-www/> (GitHub Pages, the `site/` folder)
- Analysis: `api/analyze.js`, a Vercel function that asks Upstage Solar for a storyboard

## How the preview works

```
browser ── GitHub API ──▶ file tree, package.json            (the visitor's own rate limit)
   │        finds the screens, then for one screen: the components it renders,
   │        the layouts around it and the project's stylesheets
   │
   └─ GET /api/board?repo=…&ref=…&path=…&rel=…&css=… ──▶ Vercel function
                                                          │ fetches those files from raw.githubusercontent.com
                                                          │ asks Solar (solar-pro4) for a storyboard, as JSON
                                                          ▼ checks and bounds the answer
   shows the mockup in a sandboxed frame,       ◀── { screen, css, page, areas }
   with the project's own stylesheets (and Tailwind's browser build when the project uses Tailwind),
   draws the dots and the options, writes the prompt as options are picked
```

- **A storyboard** is the screen as static HTML (`page`), written with the class names the code
  uses, and three or four `areas` with two to four options each. The first option of an area is
  that part as it is now; the others name a pattern of picky-eater's catalog. The format and the
  instructions are in `api/_lib/prompt.js`.
- **It looks like the product because its styles are the product's.** The page loads the
  repository's stylesheets into the frame. A desktop screen is laid out at a desktop's width and
  shown smaller when the frame is narrower.
- **The function is given file names, not text.** It fetches the files itself, so it cannot be
  used to send arbitrary text to the model. The answer must match a JSON Schema and
  `api/_lib/normalize.js` bounds it.
- **Markup from a model is not trusted.** `site/assets/preview.js` parses it and keeps only
  harmless elements and attributes; the frame is sandboxed without an origin of its own; and its
  Content Security Policy runs two scripts only and loads nothing else.
- **The same files give the same answer**, so answers are cached by Vercel's CDN. A first
  analysis takes about a minute: the model writes a whole screen.
- **The sample** on the page is the real markup and CSS of picky-eater's `examples/react-app`,
  captured from the running app by `scripts/capture-sample.mjs` into
  `site/assets/sample-data.js`. Its words are in `site/assets/sample.js`.

## Develop

Node.js 20 or newer. There is nothing to install.

```sh
npm run dev -- --mock   # http://127.0.0.1:4321, the analysis answers with a canned storyboard
                        # (MOCK_FILE=answer.json: with a saved answer of the model)
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
| `PE_DEBUG_KEY` | Optional. With it, `&debug=<that value>` adds the model's raw answer to the response, for tuning the instructions |
| `ALLOWED_ORIGINS` | Optional. More origins that may call the function, separated by commas. `https://telicity-ai.github.io` and localhost are always allowed |

## Languages

English is the default. Korean is chosen with the switch in the header or `?lang=ko`. Every
string of the interface is in `site/assets/i18n.js`.

## License

[MIT](LICENSE)
