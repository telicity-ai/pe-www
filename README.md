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
                                                         │ asks Solar (solar-pro4) to write the screen as HTML,
                                                         │ finds the parts of that page that can be arranged
                                                         │ another way, and asks Solar which of them matter
                                                         ▼ passes the answer on as it is written
   draws the page while it arrives,             ◀── one JSON object per line: page, marked, plan, place, option, done
   in a sandboxed frame with the project's own stylesheets
   (and Tailwind's browser build when the project uses Tailwind),
   tries every arrangement there and offers those that hold;
   writes the prompt as options are picked
```

- **A storyboard** is the screen as static HTML, written with the class names the code uses, and
  up to three areas of it, each with up to three other arrangements beside the present state.
  The instructions are in `api/_lib/brief.js`.
- **The model writes the screen and nothing else that is shown.** An option is never markup of
  its own: it is the area's own elements arranged another way, exactly as for a live web page
  (see the next section, which says what the arrangements are and how they are checked). An
  earlier version had the model write each option as HTML; those options lost content, invented
  some, and did not always fit the page around them.
- **The parts are found in the written page** (`api/_lib/page.js`), with a wider eye than for a
  live page: in an application the rows of a group of settings, the fields of a form and tiles
  with a number are items too, and words set large head a part as a heading does. A second,
  small call then says which parts matter, what each choice is called and which arrangement it
  would suggest (`api/_lib/plan.js`).
- **A screen may have no area.** A sign-in panel or a narrow form has nothing that these
  arrangements change; the screen is then shown as it is, with a word that says so.
- **Icons are named, not drawn.** The model writes `<svg data-icon="lucide:plus">`; the page
  fetches the drawing from Iconify (`site/assets/icons.js`). Coordinates of icons were a quarter
  of what the model wrote, and often wrong.
- **It looks like the product because its styles are the product's.** The page loads the
  repository's stylesheets into the frame. A desktop screen is laid out at a desktop's width and
  shown smaller when the frame is narrower. A project with a dark variant is shown as the
  visitor's system is set, with a switch beside it. What an application sets while it runs (a
  theme chosen in its settings) is not there.
- **The function is given file names, not text.** It fetches the files itself, so it cannot be
  used to send arbitrary text to the model. `api/_lib/answer.js` reads and bounds the answer; a
  page that is the project's source code instead of HTML is broken off and asked for again.
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
  out what would run (`api/_lib/page.js`); nothing is written by the model, so it is there
  after a second or two.
- **An option is the page's own elements, arranged another way.** The parts that can be
  arranged are found in the page's structure: a group of like items (features, plans, quotes)
  or a block around a heading (a hero). Of a group the items can stand in columns, in rows,
  in rows with the picture beside the text, in one row that is scrolled, or with the first one
  large; of a block the text can be centered, aligned left, or put beside its picture. No
  word and no picture is written anew, so none is lost or invented.
- **The preview carries an arrangement out and checks it** (`site/assets/preview.js`), where
  the page's styles and sizes are known: an arrangement that comes to what the page does
  today, that squeezes an item, cuts something off or makes items overlap is not offered, and
  an area with no arrangement left is no area. So a page may show fewer than three areas, or
  an area one option.
- **The model is asked once**, for what needs a reader: which parts matter to a visitor, what
  each choice is called, and which arrangement it would suggest and why. The first suggested
  arrangement that held on the page is the one marked. Without an answer the first parts of
  the page are offered with nothing marked.
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
                        # (test/fixtures/answer.json: open ?repo=shadcn-ui/taxonomy;
                        #  MOCK_FILE=other.json, MOCK_SPEED=4 for four times as fast)
UPSTAGE_API_KEY=… npm run dev   # the real analysis
npm test
```

The pattern catalog in `api/_lib/catalog.js` is generated from a picky-eater checkout (an
arrangement that has a name there carries it into the prompt; a test checks that it still has):

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
