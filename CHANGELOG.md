# Changelog

Census follows [semantic versioning](https://semver.org), and **its output counts as its API**: people diff it, grep it and hand it to models, so a change to the lines you read is a breaking change and not a patch.

Covered by that promise: the census and diff text, rules.json, the CLI's flags and exit codes, and the exported functions. Not covered: the wording of a benchmark, and anything in census.json the README doesn't name.

## Unreleased

## 0.2.0 — 2026-11-14

The first version on npm, as `@leonidstern/census` — the name `census` belongs to someone else's package. Everything below was written before any release, so there is nothing to upgrade from.

- **The census**: a live page's styles as text, grouped by value and named by your design system — color, type, corner, shadow, font, control height, and the states behind hover, press and focus, with the component that drew each one and the file and line that placed it.
- **`census diff`**: what changed between two captures, element by element, with the values that come and go. `--live` leaves out what changes on its own, so prices and charts don't read as regressions.
- **Layout**: gaps, padding and how children sit, plus the problems that make a page wrong rather than merely inconsistent — cut text, overlaps, faint words, covered controls.
- **Accessibility**: WCAG 2.2 AA contrast, focus visible and target size, with their exceptions, under `extends: "recommended@1"`. Findings a computed style can't settle are marked `(unsure)` and never fail a build.
- **Rules for the screen**: with `roles`, `text`, `states`, `pairs` and `legacy` in rules.json, a `rules broken` group says where the screen breaks them — a dialog whose fill isn't the one its role takes, text in a color text may not use, a text and fill pair your system doesn't allow, a hover that steps to another grey instead of the wash, a part that should be gone still on screen. `contrast` sets the floor below which words count as faint.
- **Maximums**: how many distinct values a group may hold at all. On by default when rules.json gives no values, so a first run with no file still has a verdict. `--fail-on max-worse` fails only when a group grew, so a repository already over its maximums can adopt it today and never get worse.
- **No runtime dependencies**, Node 22+, and a capture that drives Chrome over the DevTools Protocol — Playwright optional, not required.
