# Changelog

Census follows [semantic versioning](https://semver.org), and **its output counts as its API**: people diff it, grep it and hand it to models, so a change to the lines you read is a breaking change and not a patch.

Covered by that promise: the census and diff text, rules.json, the CLI's flags and exit codes, and the exported functions. Not covered: the wording of a benchmark, and anything in census.json the README doesn't name.

## Unreleased

- **Content heights**: two uses of a part a pixel apart in height, where no rule sets either height (a longer line, a taller icon), read as one look, `h134-135 (its content's)`, and no longer as `IN 2 LOOKS` or `near 134px (same part)`. A height a rule sets still counts each pixel.

## 0.3.0 — 2026-11-14

**Breaking: the max lines read differently**, which by the promise above makes this a minor version, not a patch. The ids (`max|fill`) are the same, but `n` for type now counts sizes, so a `--fail-on max-worse` diff across this upgrade compares two different units: capture main again after upgrading.

- **Max counts what a design system would list.** Icons aren't counted in text or fill: an icon's color isn't one of the system's text colors. Type counts sizes, not size/weight/line-height, because a type scale is a list of sizes. On three pages of a well-made public site, 5 of 9 text colors were icons and 16 type rows were 7 sizes — enough to put both over their max with nothing wrong.
- **Max names the values a hair off another, not the rare ones.** It used to name the rarest values as the likeliest accidents. On a well-made page the rarest values are its one h1 and its one hero size, so it told people to drop their headings. It now names only a value within a hair of one used more (`near`), and when nothing is, it says so and names nothing.
- **Captures no longer trip a page's Content-Security-Policy.** Turning transitions off while states are forced, and `--hide`, each added a `<style>` element, which a strict `style-src` refuses. So on those sites transitions kept running while hover and press were read, `--hide` hid nothing, and the browser sent a violation report to the site's security address on every capture. Styles now go in as a DevTools inspector stylesheet, which CSP doesn't apply to. Tested against a local server with `style-src 'self'` and a `report-uri`: the old code sent 3 reports, read hover mid-transition and hid nothing; this sends none and gets all three right.
- **A request the last page left open no longer holds up the next one.** A report fired as one page unloads never says it finished, and the reload waited up to 5 s for it to age out. Navigating now starts the list of open requests afresh.

## 0.2.1 — 2026-11-14

- `require("@leonidstern/census/package.json")` works. `exports` didn't list it, so Node refused the subpath with `ERR_PACKAGE_PATH_NOT_EXPORTED` — which breaks the tools that read a package's version that way. Found by installing 0.2.0 from the registry rather than by reading the file.

## 0.2.0 — 2026-11-14

The first version on npm, as `@leonidstern/census` — the name `census` belongs to someone else's package. Everything below was written before any release, so there is nothing to upgrade from.

- **The census**: a live page's styles as text, grouped by value and named by your design system — color, type, corner, shadow, font, control height, and the states behind hover, press and focus, with the component that drew each one and the file and line that placed it.
- **`census diff`**: what changed between two captures, element by element, with the values that come and go. `--live` leaves out what changes on its own, so prices and charts don't read as regressions.
- **Layout**: gaps, padding and how children sit, plus the problems that make a page wrong rather than merely inconsistent — cut text, overlaps, faint words, covered controls.
- **Accessibility**: WCAG 2.2 AA contrast, focus visible and target size, with their exceptions, under `extends: "recommended@1"`. Findings a computed style can't settle are marked `(unsure)` and never fail a build.
- **Rules for the screen**: with `roles`, `text`, `states`, `pairs` and `legacy` in rules.json, a `rules broken` group says where the screen breaks them — a dialog whose fill isn't the one its role takes, text in a color text may not use, a text and fill pair your system doesn't allow, a hover that steps to another grey instead of the wash, a part that should be gone still on screen. `contrast` sets the floor below which words count as faint.
- **Maximums**: how many distinct values a group may hold at all. On by default when rules.json gives no values, so a first run with no file still has a verdict. `--fail-on max-worse` fails only when a group grew, so a repository already over its maximums can adopt it today and never get worse.
- **No runtime dependencies**, Node 22+, and a capture that drives Chrome over the DevTools Protocol — Playwright optional, not required.
