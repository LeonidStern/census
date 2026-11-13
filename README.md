# Census

**Eyes for a blind agent.** Census reads a live web page from the inside and writes what's on screen as text an AI can check. It counts every style value and names each one by your own words: tokens, text styles, corners, shadows and the components that drew it. It says what looks wrong, and where each part sits in the code. There are no screenshots and no pixels.

What an agent does with it:

- **Check a design system**: values off the tokens, a part that looks two ways, hover colors that differ.
- **Catch visual regressions**: `census diff` compares two captures and lists what changed, element by element, with no pixel noise.
- **Review a page** for layout problems: cut text, overlaps, faint words, covered controls.

```
fill (4 values)
  surface-2 ×4: button "Save" in header 8,8 56x32; button "Share" in header 72,8 62x36; button "Bold" (selected) in header 218,8 54x32
  #1e1e1e ×1 near surface-2: button "Export" in header 143,8 67x32
radius (2 values)
  13px ×1 OFF (nearest 12px) (from .card, written out): div 8,60 784x128
states (2 values)
  hover fill surface-3 ×4: button "Save" in header 8,8 56x32; button "Share" in header 72,8 62x36; button "Bold" (selected) in header 218,8 54x32
  hover fill #333333 OFF (nearest surface-3, 19 away) ×1: button "Export" in header 143,8 67x32
layout problems (2)
  cut-text button "A very long label that cannot fit" 20,98 60x32 needs 230x32
  faint p 20,144 760x18: contrast 1.2:1 (rgb(34,34,34) on rgb(19,19,19))
```

That is part of the census of `test/fixture.html`; the token names come from the rules you give it. On a React page, each place also names the part that drew it, such as `[Button variant=secondary]`, and a `parts` group lists every part and variant with its looks.

**Why text and not screenshots.** A screenshot shows that two buttons look a little different. The census says which part drew each one, with which variant, what the place that uses it changed, and the CSS rule each value comes from. It also gives the hover and pressed colors without moving the mouse. In blind tests on a production web app, Opus reading the census alone found 6 of 9 known design-system problems, in about 35 s for about $0.21 a read. Given screenshots of the same pages instead, it found 1 of 8 in an earlier round.

## What it sees

The census never takes pixels. Running inside the page, it reads:

- **Computed styles** of every visible element: colors, type, corners, shadows and heights.
- **Boxes**, for place and size, text that is cut off, and what covers what.
- **The page's CSS rules**, for hover, pressed and focus colors, ranked the way the cascade ranks them.
- **The component tree**: which part drew a place, and with which variant props (`variant`, `size`, `tone` and the like). This works in the dev builds of React, Vue 3, Vue 2, Svelte and Angular. On any other page, mark a part with `data-part="Button"` and `data-variant`.
- **Where each part was used**, with `--sources`: the file and line of the JSX or template that placed it. This comes from React's dev build, mapped through the page's source maps, and from Vue and Svelte's dev builds.
- **ARIA roles and states** (selected, disabled, open) and the words on the app's own controls.

## Capture

Census needs Node 18+ and Playwright (`npm i -D playwright`, then `npx playwright install chromium`).

```bash
npm install && npm run build
node cli/census.mjs capture --rules rules.json --out out home=https://example.com/ cart=https://example.com/cart
```

It writes `out/home.txt`, `out/cart.txt`, `out/all.txt` (the pages merged: a value on more than one page is said once) and `out/census.json`.

Options:

- `--size 1440x900`: the window size.
- `--wait 3000`: how long to wait after load, in ms.
- `--wait-for <css>`: an element to wait for first.
- `--storage state.json`: a Playwright storage state, for pages behind a sign-in.
- `--hide <css>`: elements to hide first, such as a dev overlay or a cookie banner.
- `--tour`: also opens each pop-up once and adds its look. It clicks what has `aria-haspopup` or `aria-expanded=false`, hovers a few labeled buttons, and never submits a form.
- `--closed`: also says how pop-ups that aren't open yet will look (React pages).
- `--sources`: adds where the part was used in the code (`@ src/app/footer/Footer.tsx:73`) to the places that need a fix: values set where used, values off the system, and a part in two looks. A value no part drew gets the line of its own element. Use `--root <dir>` to write paths relative to your project.

### rules.json

Every field is optional. Without rules, the census still counts and compares values; it just can't call one OFF.

```json
{
  "colors": { "surface-1": "#131313", "surface-2": "#1d1d1d", "white-5": "#ffffff0d" },
  "type": ["16/400/22", "14/500/20"],
  "radii": [4, 6, 8, 16],
  "shadows": { "shadow-popover": "8px 16px 60px 0 rgba(0, 0, 0, 0.8)" },
  "parts": ["Button", "Tabs", "Select", "Link"],
  "ignore": "#intercom-frame"
}
```

- `colors`: token name to any CSS color. A color within a hair of a token takes the token's name. A token at another opacity is written `token/NN`.
- `type`: allowed text styles, as `size/weight/line-height` in px.
- `radii`: allowed corner sizes in px.
- `shadows`: named shadows.
- `parts`: your design system's part names. A native button or link that none of them drew is marked `no DS part`.
- `ignore`: a selector for subtrees to leave out.
- `foreign: false`: keeps what no component drew. By default, on a React page, such a subtree is named once under "left out".

## Visual regression

Capture before and after a change, then diff:

```bash
node cli/census.mjs capture --rules rules.json --out before home=http://localhost:3000/
# ...switch branch or deploy the change...
node cli/census.mjs capture --rules rules.json --out after home=http://localhost:3000/
node cli/census.mjs diff before/census.json after/census.json
```

On a page with live data (prices, charts, clocks), take a second capture before the change and pass it with `--live same/census.json`: what differs between the two before captures changes on its own and is left out.

```
census diff: 1 changed, 1 new, 1 gone; 6 only moved (not listed)
changed (1)
  button "Share" in header 84,8 62x40: height button 36px→40px; states hover fill surface-3→#333333
new (1)
  button "Delete" 20,180 66x32: height button 32px; radius 8px; fill #ff0000 OFF (nearest surface-3, 222 away); ...
gone (1)
  button "Bold" (selected) in header 218,8 54x32: state selected; height button 32px; ...
values new on the page (2)
  fill #ff0000 OFF (nearest surface-3, 222 away) ×1: button "Delete" 20,180 66x32
```

Elements are matched by name, part and region. When their words change, they are matched without them and the diff says `words "Old"→"New"`. Elements that only moved are counted, not listed. A box that grows because of what's in it isn't listed either. The diff also gives values new on the page or gone from it, parts that gained or lost a look, and layout problems that appeared or were fixed. Give the diff and the change's description to an AI and ask which changes weren't meant.

## Ask an AI

```bash
node cli/census.mjs prompt --docs ds-rules.md --app "a recipe site" out/all.txt > prompt.txt
```

`ds-rules.md` is your design system's rules in a few lines of words. The prompt tells the reader what each group means and how to judge: a variant, size or state is the design system's choice, not an inconsistency. Send the prompt to a model with no tools. We use Opus; in our tests, smaller models made more wrong claims.

## For agents

An agent runs the capture CLI and reads the text files. That's one command and no browser handling. With `--sources`, it can go straight to the line to fix.

An agent that already drives a browser, through Playwright MCP, Chrome DevTools MCP or its own script, can skip the CLI:

1. Run the contents of `dist/census.js` in the page (an evaluate call). It sets `window.census`.
2. Run `census.lines(census.data(rules)).join("\n")` and read the text.

This route maps no source maps, so React 19's places stay bundled-code frames (`@ {url:line:col …}`).

## In your own page

```ts
import { styleData, censusLines, layoutLines } from "census";
const text = censusLines(styleData(rules)).join("\n");
```

`dist/census.js` is the same thing as one script that sets `window.census` (`data`, `lines`, `merge`, `layout`). `layoutLines()` alone gives the screen as a wireframe with what looks wrong: cut text, overlaps, faint words, buttons with no visible edge, and covered controls.

## Privacy

Words come only from the app's own controls: buttons, menu items, tabs and headings. What people typed or wrote shows only as its tag. Mark anything else private with `data-census-private`. Mark a control that is dim on purpose with `data-census-dim`.

## Safety

- **The census only reads.** For one synchronous moment it lifts `inert` and pointer-events so it can hit-test what covers what, then puts them back. It sends nothing anywhere: the page's own script gets the text.
- **`--tour` clicks.** It presses only controls that open something (`aria-haspopup`, `aria-expanded=false`), never a submit, and hovers a few labeled buttons. Still, don't tour a signed-in production account where a menu item could do something on its own.
- **`--sources` fetches source maps only from the captured pages' own origins**, with no redirects and at most 64 MB a file. A page's stack frames can name any address, so nothing else is fetched.
- **Page words are data.** The census quotes the app's own button and heading words, and a hostile page could write instructions there. The reader prompt says to treat them as data. Run the reader with no tools, as `census prompt` assumes.

## Tests

```bash
npm test
```

This runs the pure parts in Node, then a sample page (`test/fixture.html`) in Chromium.

## Licence

MIT
