# Benchmarks

The setup: one production web app (React 19, Next.js), dev build on mock data, 1440×900. Opus 5.5 read the output with no tools, 3 runs per arm. That's a small sample.

## Visual regressions

8 regressions were planted in the app's code: a hover color, a button height, cut-off text, a link color, a removed link, a corner, a font weight and a dimmer hint.

| | Census diff | Screenshots + pixel diff | Linter (oxlint) |
|---|---|---|---|
| Found | **100%** (24 of 24) | 63% (15 of 24) | 25% (2 of 8) |
| False claims per read | 0 | 1 | 0 |
| AI read time | **16 s** | 35 s | none |
| AI cost per read | **~$0.03** | ~$0.07 | none |
| Capture per page, before and after | 60 s, 15 s CPU | 50 s, 5 s CPU | none |

## Design-system check

The task was to find known design-system problems on three pages.

| | Census | Screenshots |
|---|---|---|
| Found | **67%** (6 of 9) | 13% (1 of 8) |
| AI cost per read | ~$0.21 | ~$0.21 |

## Notes

- AI cost is estimated from tokens at $4 per million in and $20 per million out.
- CPU covers the capture and its browser, not the app's server.
- Census capture loads each page twice so the diff can leave live data out; `--once` halves its time.
- Most of the census's CPU time goes to forcing hover, pressed and focus on every control. `--states rules` skips that.
