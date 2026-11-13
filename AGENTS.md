# Working on Census

Notes for agents and people changing this repo. To use Census, read README.md.

## Layout

- `src/census.ts`: everything that runs in the page: `styleData` (the census), `censusLines` (it as text), `mergeCensus`, `layoutLines`, and the forced-state hooks (`forceMark`, `forceStep`, `forceDone`).
- `src/diff.ts`: `census diff`. Pure; runs in Node or the page.
- `src/color.ts`: color parsing and contrast.
- `src/browser.ts`: builds `dist/census.js`, the one script that sets `window.census`.
- `src/index.ts`: builds `dist/census.mjs`, the library.
- `cli/census.mjs`: the commands (`capture`, `diff`, `prompt`).
- `cli/cdp.mjs`: the capture's own DevTools Protocol client. It starts Chrome or attaches to one.
- `cli/read.mjs`: what a capture does in a page for any driver: forcing states, fetching source maps.
- `cli/sourcemap.mjs`: source maps with no dependencies, index maps included.
- `cli/playwright.mjs`: `census/playwright`, the helper for people's own Playwright tests.
- `prompt/read.md`: the reader prompt `census prompt` fills in.

## Rules

- **No runtime dependencies.** The CLI uses Node 22's WebSocket and fetch. Playwright is only an optional dev dependency for the in-page tests.
- **The census only reads the page.** Anything it adds (marks, a style that stops transitions) comes off again in the same call or in a `finally`.
- **Privacy:** words come only from the app's own controls (`WORDY` in `src/census.ts`). Never quote what people typed.
- **Text for a blind reader:** one line a value, a place as `role "words" [Part] in #region x,y wxh @ file:line`. A new group or word in the text also goes in `prompt/read.md` and the README's "For AI agents".
- **Tests:** `npm test` must pass. Add a check in `test/census-test.mjs` for each new behavior: pure parts as plain checks, page behavior on `test/fixture.html` or a small new page in `test/`.
- **Nothing private:** never add code, file names or captures from someone's app to this repo. Test pages are made up.
