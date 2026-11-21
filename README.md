# pe-www

The landing page of [picky-eater](https://github.com/telicity-ai/picky-eater), with a preview
that reads a public GitHub repository and lets a visitor try the skill in the browser: pick
options on one of their own screens, and take the result away as a prompt.

- Page: <https://telicity-ai.github.io/pe-www/> (GitHub Pages, the `site/` folder)
- Analysis: `api/draw.js`, a Vercel function that asks Upstage Solar for a storyboard

## How the preview works

```
browser ── GitHub API ──▶ file tree, package.json            (the visitor's own rate limit)
   │        finds the screens, then for one screen: the components it renders,
   │        the layouts around it and the project's stylesheets
   │
   └─ GET /api/draw?repo=…&ref=…&path=…&rel=…&css=… ──▶ Vercel function
                                                         │ fetches those files from raw.githubusercontent.com
                                                         │ asks Solar (solar-pro4): one call for the page,
                                                         │ and meanwhile one call for each piece of each area
                                                         ▼ passes the answer on as it is written
   draws the page while it arrives,             ◀── one JSON object per line: plan, page, area, option, done
   in a sandboxed frame with the project's own stylesheets
   (and Tailwind's browser build when the project uses Tailwind),
   then the dots and the options; writes the prompt as options are picked
```

- **A storyboard** is the screen as static HTML, written with the class names the code uses, and
  two or three areas with two options each beside the present state. An option names a pattern
  of picky-eater's catalog. The instructions are in `api/_lib/brief.js`.
- **A person waits for the longest call, not for their sum.** The first call names the areas
  (each by the opening tag of its element in the source) and writes the page around them. As
  soon as an area is named, three more calls start: that element as it is today, and the same
  element with each of two patterns. A screen shows after a few seconds and is complete in
  about twenty, where one call for everything took a minute or more. `api/draw.js` holds the
  calls together; `site/assets/board.js` puts the pieces together, also when the page wrote out
  a part that an area brings itself.
- **Icons are named, not drawn.** The model writes `<svg data-icon="lucide:plus">`; the page
  fetches the drawing from Iconify (`site/assets/icons.js`). Coordinates of icons were a quarter
  of what the model wrote, and often wrong.
- **It looks like the product because its styles are the product's.** The page loads the
  repository's stylesheets into the frame. A desktop screen is laid out at a desktop's width and
  shown smaller when the frame is narrower.
- **The function is given file names, not text.** It fetches the files itself, so it cannot be
  used to send arbitrary text to the model. `api/_lib/answer.js` reads and bounds the answer; an
  answer that is the project's source code instead of HTML is broken off and asked for again.
- **Markup from a model is not trusted.** `site/assets/preview.js` parses it and keeps only
  harmless elements and attributes; the frame is sandboxed without an origin of its own; and its
  Content Security Policy runs two scripts only and loads nothing else.
- **The same files give the same answer**, so answers are cached by Vercel's CDN, which also
  keeps an answer that broke off. The page notices (no `done` line, at once) and asks again
  under another address (`&try=2`).
- **The sample** on the page is the real markup and CSS of picky-eater's `examples/react-app`,
  captured from the running app by `scripts/capture-sample.mjs` into
  `site/assets/sample-data.js`. Its words are in `site/assets/sample.js`.

## Develop

Node.js 20 or newer. There is nothing to install.

```sh
npm run dev -- --mock   # http://127.0.0.1:4321, the analysis plays back a recorded answer
                        # (test/fixtures/answer.json: open ?repo=vercel/ai-chatbot;
                        #  MOCK_FILE=other.json, MOCK_SPEED=4 for four times as fast)
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
| Analysis | The Vercel project is connected to this repository: a push to `main` deploys it. The page on github.io calls the address in `site/assets/config.js` |

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
