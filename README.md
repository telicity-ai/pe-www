# pe-www

The landing page of [picky-eater](https://github.com/telicity-ai/picky-eater), with a preview
that reads a public GitHub repository and lets a visitor try the skill in the browser: pick
options on one of their own screens, and take the result away as a prompt.

- Page: <https://telicity-ai.github.io/pe-www/> (GitHub Pages, the `site/` folder)
- Analysis: `api/storyboard.js`, a Vercel function that asks Upstage Solar for a storyboard

## How the preview works

```
browser ── GitHub API ──▶ file tree, package.json            (the visitor's own rate limit)
   │        finds the screens, then for one screen: the components it renders,
   │        the layouts around it and the project's stylesheets
   │
   └─ GET /api/storyboard?repo=…&ref=…&path=…&rel=…&css=… ──▶ Vercel function
                                                         │ fetches those files from raw.githubusercontent.com
                                                         │ asks Solar (solar-pro4): one call writes the screen;
                                                         │ each area's element then goes to a call per option
                                                         ▼ passes the answer on as it is written
   draws the page while it arrives,             ◀── one JSON object per line: plan, page, place, option, done
   in a sandboxed frame with the project's own stylesheets
   (and Tailwind's browser build when the project uses Tailwind),
   then the dots and the options; writes the prompt as options are picked
```

- **A storyboard** is the screen as static HTML, written with the class names the code uses, and
  two or three areas of it with two options each beside the present state. An option names a
  pattern of picky-eater's catalog. The instructions are in `api/_lib/brief.js`.
- **The page is of one piece.** One call names the areas and writes the whole screen, the areas
  included; an area is a stretch of that page, not something written apart from it. The plan
  says how each area's element begins, so the function finds the element in the page as it is
  written (`api/_lib/answer.js`) and, as soon as it is complete, has each option drawn by a call
  of its own that is given that element. A screen shows after a few seconds; it is complete a
  little after the page is. (An earlier version had the areas written apart from the page, by
  calls that ran beside it: faster by some seconds, but the pieces did not always fit.)
- **Icons are named, not drawn.** The model writes `<svg data-icon="lucide:plus">`; the page
  fetches the drawing from Iconify (`site/assets/icons.js`). Coordinates of icons were a quarter
  of what the model wrote, and often wrong.
- **It looks like the product because its styles are the product's.** The page loads the
  repository's stylesheets into the frame. A desktop screen is laid out at a desktop's width and
  shown smaller when the frame is narrower. A project with a dark variant is shown as the
  visitor's system is set, with a switch beside it. What an application sets while it runs (a
  theme chosen in its settings) is not there.
- **The function is given file names, not text.** It fetches the files itself, so it cannot be
  used to send arbitrary text to the model. `api/_lib/answer.js` reads and bounds the answer; an
  option that is the project's source code instead of HTML is broken off and asked for again.
- **Markup from a model is not trusted.** `site/assets/preview.js` parses it and keeps only
  harmless elements and attributes; the frame is sandboxed without an origin of its own; and its
  Content Security Policy runs two scripts only and loads nothing else.
- **The same files give the same answer**, so answers are cached by Vercel's CDN, which also
  keeps an answer that broke off. The page notices (no `done` line, at once) and asks again
  under another address (`&try=2`).
- **The sample** on the page is the real markup and CSS of picky-eater's `examples/react-app`,
  captured from the running app by `scripts/capture-sample.mjs` into
  `site/assets/sample-data.js`. Its words are in `site/assets/sample.js`.

## A web address instead of a repository

Typed a web address (`example.com/pricing`), the page asks `api/site.js` instead:

- **The page is the site's own.** The function fetches the page and its stylesheets and takes
  out what would run (`api/_lib/page.js`); nothing is written anew by the model, so it is
  there after a second or two. One call names three areas from an outline of the page's
  elements; then each option of each area is drawn by a call of its own, from that element
  with its pictures and drawings set aside and put back afterwards.
- **Only public pages, as they are served.** No address inside a private network is fetched,
  and every redirect is looked at again (`api/_lib/web.js`). A page that is drawn by its
  scripts, or that asks to sign in, arrives all but empty and is refused with a word on why.
- **Shown without its scripts**, in the same sandboxed frame, with its own pictures and fonts
  (a font that its server does not share with other origins falls back to the next one).
- **The prompt names the address**, not a file: the agent that gets it has to find the code.

This needs one dependency (`parse5`, to read HTML as a browser does), so there is an install
step now: `npm install`.

## Develop

Node.js 20 or newer. `npm install` once (one dependency, for reading web pages).

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
