# Design Critique — Ten-Level Chinese Flashcards

A structured review across usability, hierarchy, consistency, and accessibility — pass / find / fix format.

---

## 1 · Usability

| ✅ Pass | 🔎 Finding | 🛠 Fix applied / suggested |
| --- | --- | --- |
| Lesson cards are the obvious primary action on the home page (paper card, accent border on hover). | The first-time user has no signal that *clicking* the card flips it — only the "Tap card or press Space to flip" microcopy at the bottom. | Already showing a centred hint on the front face; consider a one-time onboarding pulse on the first card of the first session. *(suggested, not implemented)* |
| Four grade buttons follow Anki's mental model exactly (Again / Hard / Good / Easy). | The shortcuts `1 2 3 4` are next to the labels, but their colours are easy to miss at first glance. | Added semantic colours and hover backgrounds tinted with the same hue so colour is also signalled on rest, not only on hover. |
| Cards auto-advance 220 ms after grading — fast enough to feel responsive, slow enough to read the back. | Reset / Shuffle / Restart all live in one nav row, no destructive confirmation. | Reset only restarts the current deck; the *destructive* reset (all grades, all lessons) lives behind a `confirm()` in Settings. |
| Mobile and desktop both fit the card comfortably. | At ≤ 540 px the four-column action row gets cramped. | Stacks label-over-key inside each button under 540 px so the row keeps its rhythm. |

## 2 · Visual hierarchy

| ✅ Pass | 🔎 Finding | 🛠 Fix applied / suggested |
| --- | --- | --- |
| Hero uses an eyebrow chip → display heading → lede → stats — a clean F-shape. | First version had stats clumped without separators; the eye couldn't parse three values from one another. | Added 1 px rule dividers between stat columns and a min-width on the column to stabilise the layout. |
| The flashcard is unambiguously the biggest thing on the study view. | Position counter and breadcrumb compete for the same row. | Position counter is pulled into a pill on the right; breadcrumb stays caps-tracked and muted, so weight differs by both size and treatment. |
| Three "mode cards" colour-code their content (red / jade / gold). | The mode-card arrow `→` is the same colour as the icon at rest, so it doesn't read as an affordance. | Arrow slides + brightens to accent on hover. *(Could be stronger; the icon-only arrow may be too quiet on first impression.)* |

## 3 · Consistency

| ✅ Pass | 🔎 Finding | 🛠 Fix applied / suggested |
| --- | --- | --- |
| Every interactive element uses the same shadow ladder (`--sh-1` rest → `--sh-3` hover). | Two different paper textures were in early drafts. | Unified on one radial-dot pattern at 6 px tiling, with `mix-blend-mode: multiply` (light) / `screen` (dark). |
| Spacing follows an 8-pt grid (`--s-1` … `--s-9`). | Some old `padding: 14px` lurked from rapid prototyping. | All inline magic numbers replaced with tokens. |
| Type system splits roles cleanly: Inter for UI, Noto Serif SC for Chinese, JetBrains Mono for chips & code. | Pinyin needs italics but Inter's italic can look thin against bold Chinese. | Kept Inter italic but bumped pinyin to 500 weight in lesson detail and to 24–28 px on the back face so the curve weight matches the Chinese. |

## 4 · Accessibility

| Audit | Result |
| --- | --- |
| WCAG AA contrast (body text) | **~16:1** — pass |
| WCAG AA contrast (muted/secondary text) | **~5.5:1** — pass |
| Visible focus on every interactive | 2 px accent outline via `:focus-visible` |
| Keyboard-only flow | Tab order: skip-link → brand → settings → 20 lesson cards → footer. On study: card → grade buttons → nav row → finished CTAs. Verified. |
| Reduced motion | Honoured automatically; manual toggle in Settings as a second guarantee. |
| Screen reader | Card has `aria-label` and `aria-pressed`; counter has `aria-live="polite"`; progress bar has `role="progressbar"`; lesson links include the lesson title in the label. |
| Touch targets | ≥ 44 × 44 on every button. Skip-link is `position: absolute; left: -9999px` and reveals on focus. |
| Colour-blind safety | All grade buttons carry text labels and shortcut chips, not just hue. |

## 5 · Content & language

- Pinyin uses standard diacritics (`hǎojiǔ`, `dǔ chē`) rendered via Inter italic — no fallback boxes.
- Punctuation: the textbook uses Chinese punctuation (`，。？！》`); the data file preserves it. UI strings use English punctuation.
- Tone choice: the eyebrow `拾级汉语 · 综合课本 · 第2级` cites the source in its own language; everything else is plain English. Avoids forced "Hello, lovely learner!" voice.
- Empty states: if a lesson is missing sentence data, the study view renders an "(no cards yet)" message rather than a blank card.

## 6 · Open issues / next iteration

1. **First-time hint** — the "Tap card to flip" microcopy is necessary but always present. Replace with a one-time onboarding pulse and persist the dismissal in `localStorage`.
2. **Audio** — no TTS yet. The Chinese learners this is built for benefit from hearing tones; adding `speechSynthesis(zh-CN)` is a 30-line patch.
3. **Spaced repetition** — currently a flat "graded" set; an SM-2 schedule keyed off the existing `grades` map would be backwards compatible.
4. **Stroke order** — Characters mode would benefit from a Hanzi Writer overlay on the back face.
5. **Mode arrows** — the `→` glyph on the mode cards could promote to a button-style chip for stronger affordance.

---

Overall: the site reads as deliberately quiet and book-like, which matches the source material. Hierarchy, motion, and accessibility are all in good shape. The largest "next" investment is *audio*, not visual polish.
