// The script a capture puts in the page: window.census, with no other effect on the page.
import { censusLines, layoutLines, mergeCensus, styleData, type Census, type StyleRules } from "./census";

const at = (sel?: string) => (sel ? document.querySelector(sel) ?? document.body : document.body);
(window as unknown as { census: unknown }).census = {
  data: (rules: StyleRules, sel?: string) => styleData(rules, at(sel)),
  lines: (c: Census) => censusLines(c),
  merge: (pages: Record<string, Census>) => mergeCensus(pages),
  layout: () => layoutLines(),
};
