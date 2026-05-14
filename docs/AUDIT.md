# Audit & Fix Checklist — Round 1

Triggered by the bug report: "i cant practice characters at all. its giving me the same english translation for every characters."

Below is everything I found wrong, root-caused, and fixed in this round. Each item: **what broke → why → fix → how to verify.**

---

## 🟥 Critical (blocked usage)

### 1 · Character mode showed the same English on every card
- **Symptom.** Front: any 漢字. Back: always "— learn to read & write."
- **Root cause.** In `app.js`, `buildDeck` for `mode === 'characters'` hardcoded `english: '— learn to read & write'` for every card. The data file had no per-character meanings (the textbook's 读写字 section is just a list of hanzi to practise; the meanings live inside the compound words in the same lesson's vocab).
- **Fix.**
  - Added a preprocess step (`/tmp/clean_lessons.py`) that walks each lesson and, for every 读写字 character, collects the vocab words in the same lesson that contain it, the example sentences that contain it (fallback), and the character's own pinyin syllable (extracted via a tone-anchored syllable splitter). Stored in `char_compounds`, `char_examples`, and `char_pinyin`.
  - Rewrote `buildDeck('characters')` to pass these through.
  - New `renderCharBack()` renders a structured back: pinyin → "Appears in" list of compound words with pinyin and English. If no compounds exist, falls back to "In context" sentences. If neither exists (16/400 chars introduced solely for handwriting), shows a friendly fallback.
- **Verify.** Open `#/study/1/characters`, flip card 久 → shows `jiǔ` + 好久不见 (hǎojiǔ bù jiàn — long time no see).
- **Coverage.** 384 / 400 chars have real context. 345 / 400 have a per-char pinyin label.

### 2 · 150 sentence cards leaked their answer onto the front
- **Symptom.** Sentence card front: `好多 many`, `37度 37 degrees`, `绿色 green (color)` etc. — defeats the point of a flashcard.
- **Root cause.** When I transcribed the textbook, mini-examples shown beside vocab definitions were copied with their English gloss inline into the `chinese` field.
- **Fix.** `strip_inline_gloss()` in the cleanup script: keeps everything before the first whitespace-then-ASCII-letter-or-digit boundary. Run twice; final pass caught `37度 37` and `零下3度 3` which only had digit fragments.
- **Verify.** `#/study/8/sentences` — card 3 is now `最好` (was `最好 best`), card 8 is `37度` (was `37度 37 degrees`), card 14 is `零下3度`. Zero residual cases now in the data (`grep` confirmed).

---

## 🟧 Major (broken UX in supported modes)

### 3 · "Front: English → Chinese" inverted mode broke the layout
- **Symptom.** When the user flipped the setting, English text was pumped into the giant serif Chinese slot — 9rem of "long time no see" wrapping ugly.
- **Root cause.** `renderCard()` only swapped the *contents* of the slots, not their styling.
- **Fix.** When inverted, add `.card--front-en` class on `#card`; CSS swaps font-family (Inter), font-size (~38px), letter-spacing, and makes the back's "english" slot use the serif Chinese font instead.
- **Verify.** Settings → "Card front: English → Chinese, pinyin" → vocab card 好久不见 now shows "long time no see" in sans-serif at a readable size; flip reveals 好久不见 in serif.

### 4 · Hero copy lied about the data size
- **Symptom.** Home page said "540 words and 330 example sentences." Real totals are 569 / 362 / 400.
- **Root cause.** Hardcoded numbers in `index.html`.
- **Fix.** `meta.vocab_total`, `meta.sentence_total`, `meta.character_total` added by the cleanup script. New `#heroLede` is rewritten by `renderHome()` from the data each load. Meta tag in `<head>` updated to match.
- **Verify.** Reload `/` — copy reads "569 words, 362 example sentences, and 400 characters."

### 5 · "Auto-flip on grade" toggle did nothing
- **Symptom.** Setting existed in the dialog but no code read `state.settings.autoFlip`.
- **Fix.** Removed the toggle from `index.html`, the handler from `app.js`, and the field from `defaultSettings()`. (The natural flow already shows the front of each new card, so an auto-flip toggle has no useful meaning here.)
- **Verify.** Settings dialog now has 4 controls, not 5.

### 6 · Navigation kept "working" after the deck was finished
- **Symptom.** On the finished screen, pressing `←` / `→` / `j` / `k` silently changed `state.index`, so when you clicked **Study again**, you started mid-deck instead of at card 1.
- **Fix.** Added `state.finished` flag set by `showFinished()`. `nextCard()`, `prevCard()`, and the keyboard handler short-circuit when `finished === true`. All restart paths (`#btnReset`, `#finishedRestart`, `#btnShuffle`) clear it.
- **Verify.** Finish a deck → press arrows several times → click **Study again** → first card is card 1, not card 4.

---

## 🟨 Minor (data quality / polish)

### 7 · Pinyin syllable splitter mis-split nasal-coda finals
- **Symptom.** 检 → "jiǎ", 查 → "nchá" (instead of "jiǎn" + "chá"). Affected ~30 characters whose pinyin contains `n`, `ng`, or `r` codas.
- **Root cause.** First version of `split_pinyin_syllables` walked backward from the second toned vowel until it hit a consonant, missing the trailing `-n`/`-ng`/`-r` belonging to the first syllable.
- **Fix.** Rewrote it as a forward walker that anchors on tone-marked vowels and greedily consumes diphthong tail + nasal coda (longest match: `ng` > `n` > `r`).
- **Verify.** Unit tests for `hǎojiǔ`, `jiǎnchá`, `yīnggāi`, `dōngběi`, `huānyíng`, `kāishǐ`, `zhōngyú`, `shǒuxiān` all split correctly.

### 8 · `T恤` in vocab field would have been over-stripped
- **Fix.** Special-cased in the cleanup loop. `T恤` is a legitimate mixed loanword for "T-shirt" and must be preserved.

### 9 · No coverage for 16 "handwriting-only" characters
- **Status.** Acknowledged. These chars (e.g. 当, 谢, 课, 警, 察, 跟) appear in the lesson's 读写字 list but not in vocab/sentences of the same lesson. The back card shows: *"Practice writing this character — it's introduced for handwriting in this lesson."* — better than a misleading translation.

---

## ⚙ Deployment audit

### 10 · GitHub Pages live and serving the new data
- **Verify.** `https://petervanpercson.github.io/chinese-flashcards/` reloads with new commit `d55486f`. `lessons.json` on prod contains `char_compounds`.

### 11 · `.gitignore` covers `.claude/` (local-only paths in `launch.json`) and `.DS_Store`
- Confirmed in repo.

### 12 · Public repo, no secrets, no PII
- Confirmed. Only source files + lesson data + design docs.

### 13 · Repo licence
- **Open.** Not added yet. Lesson content is paraphrased from a BLCU Press textbook; not redistributable verbatim. Recommend adding `LICENSE` covering only the code and a `NOTICE` clarifying the data is for personal study only. (Optional — not blocking your classmates' use.)

### 14 · Google Fonts as the only external dependency
- Verified. No tracking scripts, no analytics, no CDN beyond fonts.googleapis.com.

---

## 🟦 What's still on the desk (not blocking)

| # | Item | Why deferred |
| --- | --- | --- |
| a | A few learning examples lumped two phrases into one (e.g. `更高 / 更大`). | Preserves textbook order; either phrase is correct study material. |
| b | No offline support (service worker). | First load needs internet anyway for Google Fonts; not a regression. |
| c | 16 chars without compound context. | Handwriting-only chars; the fallback message is honest. |
| d | Lesson detail vocab table doesn't show example phrases. | Out of scope for this fix; full info already lives on each card's back. |

---

## How to verify everything in 60 seconds

1. Open `https://petervanpercson.github.io/chinese-flashcards/`.
2. Confirm the hero says **569 words, 362 example sentences, and 400 characters**.
3. Click Lesson 1 → **Characters** → flip card 久 → you should see `jiǔ` and the compound `好久不见 / hǎojiǔ bù jiàn / long time no see`.
4. Lesson 8 → **Sentences** → card 3 should be just `最好`, no English.
5. Settings → **Card front: English → Chinese** → vocab cards now show English in sans-serif, flip to Chinese in serif.
6. Grade through a small deck (Lesson 2 sentences, 16 cards) → finish → press `←` 5 times → click Study again → first card is card 1.

If anything above fails, raise it and I'll trace it.
