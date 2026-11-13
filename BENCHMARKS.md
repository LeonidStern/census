# Benchmarks

The setup: one production web app (React 19, Next.js), dev build on mock data, 1440×900. Opus 5.5 read the output with no tools, 3 runs per arm. That's a small sample.

## Visual regressions

8 regressions were planted in the app's code: a hover color, a button height, cut-off text, a link color, a removed link, a corner, a font weight and a dimmer hint.

| | Census diff | Screenshots + pixel diff | Playwright MCP snapshot |
|---|---|---|---|
| Found | **100%** (24 of 24) | 63% (15 of 24) | 25% (6 of 24) |
| False claims per read | 0 | 1 | 0 |
| AI read time | **16 s** (54% less) | 35 s | 18 s |
| AI cost per read | **~$0.03** (57% less) | ~$0.07 | ~$0.06 |
| Capture time per PR | **11 s** (31% less) | 16 s | 13 s |
| Capture CPU per PR | 13 s (8% more) | 12 s | 12 s |

Per PR, main's capture is cached for every way: census captures the PR once per page, and screenshots take one shot. Without the cache, a full before/after takes census 34 s and 40 s CPU, and screenshots 48 s and 35 s CPU (3 shots, one to spot live data).

The Playwright MCP arm is what an agent sees through `browser_snapshot` (@playwright/mcp 0.0.85, default flags, 1440x900, the same 12 s wait): the accessibility tree with roles, names and text. Its ref ids were stripped so versions line up, and the reader got the before-to-after diff, a before-to-before diff for live data, and the whole after snapshot (about 4 times the census text). Every read found the removed link and the new search label. None could say the label was cut off (it was counted as found) or see the hover, height, colors, corner or weight.

## Design-system check

The task was to find known design-system problems on three pages.

| | Census | Screenshots | Opus with the code, the app and Playwright |
|---|---|---|---|
| Found | **67%** (6 of 9) | 13% (1 of 8) | 33% (6 of 18, 2 runs) |
| AI cost per read | **~$0.21** | ~$0.21 | ~$1.12 |
| False claims per read | | | ~3 |

The third arm is how an agent usually checks: Opus had the repository, the app running, a shell and Playwright, and took about 6 minutes a run. It wrote its own scripts to read computed styles, but only for the elements it thought of: it saw no hover states or closed pop-ups and had to guess which token each value was and which part drew it.

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

- A lighter browser didn't help: chrome-headless-shell and lean Chrome flags used the same CPU (12 s a capture, 3 runs each).
- Census CPU goes mostly to loading the page (about 60%) and forcing hover, pressed and focus (about 25%). Controls that look and sit alike are forced once. `--states rules` skips forcing.
