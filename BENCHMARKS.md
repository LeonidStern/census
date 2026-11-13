# Benchmarks

The setup: one production web app (React 19, Next.js), dev build on mock data, 1440×900. Opus 5.5 read the output with no tools, 3 runs per arm. That's a small sample.

## Visual regressions

8 regressions were planted in the app's code: a hover color, a button height, cut-off text, a link color, a removed link, a corner, a font weight and a dimmer hint.

| | Census diff | Screenshots + pixel diff |
|---|---|---|
| Found | **100%** (24 of 24) | 63% (15 of 24) |
| False claims per read | 0 | 1 |
| AI read time | **16 s** (54% less) | 35 s |
| AI cost per read | **~$0.03** (57% less) | ~$0.07 |
| Capture time | **34 s** (29% less) | 48 s |
| Capture CPU | 40 s (14% more) | 35 s |

## Design-system check

The task was to find known design-system problems on three pages.

| | Census | Screenshots |
|---|---|---|
| Found | **67%** (6 of 9) | 13% (1 of 8) |
| AI cost per read | ~$0.21 | ~$0.21 |

## Notes

- AI cost is estimated from tokens at $4 per million in and $20 per million out.
- CPU is all of Chrome's processes plus the capture, on one page, 3 runs each. It doesn't count the app's server.
- Both ways load each page an extra time to tell live data apart. Census loads every page twice; screenshots take a second "before" shot. Each screenshot waited 12 s for the page.
- One capture of one page:

| | CPU | Wall |
|---|---|---|
| Census (2 loads) | 20 s | 17 s |
| Census `--once` | 13 s | 11 s |
| Screenshot, 12 s wait | 12 s | 16 s |
| Screenshot after the page settles | 8 s | 7 s |

- Census CPU goes mostly to loading the page (about 60%) and forcing hover, pressed and focus (about 25%). Controls that look and sit alike are forced once. `--states rules` skips forcing.
