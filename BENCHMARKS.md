# Benchmarks

Blind tests: a model reads Census output, with no tools and no screenshots, and is scored against known problems. All runs used one production web app (React 19 and Next.js on Tailwind, dev build on mock data, 1440×900). One app and a few runs: take these as signs, not proof.

## Visual regressions: `census diff` against screenshots

**Setup.** In the app's code we planted 8 regressions and made 2 intended changes:

| Plant | What changed |
|---|---|
| R1 | Hover wash on every button, one token step stronger |
| R2 | One button size 2 px taller |
| R3 | A search placeholder made longer, now cut off |
| R4 | One footer link one step brighter, by a class at its use site |
| R5 | A footer link removed |
| R6 | A toast's corner off the radius scale |
| R7 | One label's weight 400 → 600 |
| R8 | A key hint one step dimmer |

The intended changes were renaming a link and widening a gap. Each reader got the change's description, which named only those two. There were two pages, and 3 runs per arm.

- **Census arm:** the text of `census diff --live`, 8.8 KB.
- **Screenshot arm:** 8 images: before, a second "before" to show live data, after, and a pixel diff with changed pixels in red, for each page.

**Results** (Opus 5.5):

| | Census diff | Screenshots + pixel diff |
|---|---|---|
| Found, of 8 | 8, 8, 8 | 5, 5, 5 |
| False claims | 0, 0, 0 | 1, 1, 1 |
| Missed | none | R1 hover, R4 and R8 one-step colors |
| Read time | 15–18 s | 34–38 s |
| Input | ~3.5k tokens | ~14k tokens (8 images) |
| Cost a read | ~$0.03 | ~$0.07 |

Costs are estimates from the input and output sizes at $4 per million input tokens and $20 per million output tokens. A hover color never shows in a still image, and a one-step text color is a few faint red pixels in a pixel diff. The diff names both. The diff confirmed the rename but not the wider gap: it counts moves and groups them, and doesn't measure gaps.

After moves were grouped and removed controls marked `!`, two more runs found 8 of 8 again, with 0 false claims. Both confirmed the gap. Read time was 25–38 s.

**Against a linter.** The app's own oxlint rules (design-system rules included) flagged 2 of the 8: the corner off the scale and the font weight. The other six use valid classes: one valid token swapped for another, a size change inside the design system, a removal, cut text. Only a before/after read shows those.

## Design-system check: a census against screenshots

On three pages of the app, Opus reading the census alone found 6 of 9 known design-system problems. A read took about 35 s and cost about $0.21 (a 25 KB census). In an earlier round, screenshots of the same pages found 1 of 8.

## Capture speed

Times on the same app, from a dev server:

- **Page load:** the capture waits until no request is loading and the controls hold still for 0.6 s. That took about 7 s per load. A first load that also compiles the page took about 60 s.
- **Read:** 1–6 s. Most of it is forcing hover, pressed and focus on each control in view: about 6 s for 67 controls. `--states rules` skips forcing.
- **Two loads:** each page loads twice by default so `diff` can leave live data out. `--once` halves the time.
- **Playwright helper:** about 13 s for the same read with forced states. Every step goes through Playwright's protocol session.
