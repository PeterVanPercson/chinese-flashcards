# Ten-Level Chinese — Flashcards (Level 2)

A clean, Anki-style flashcard site for the **Level 2 Integrated Textbook** (拾级汉语 综合课本 第2级) by Beijing Language and Culture University Press. Every lesson is broken into three decks: vocabulary, example sentences, and the 读写字 characters.

Local-only. No accounts. No analytics. Your progress lives in `localStorage`.

---

## Run it

The site is fully static, but browsers block `fetch()` from `file://`, so it needs a one-line server:

```bash
cd ~/Desktop/chinese-flashcards
python3 -m http.server 8000
# then open http://localhost:8000
```

…or any other static server you like (`npx serve`, Live Server in VS Code, etc.).

## What's in it

- **20 lessons** transcribed directly from the textbook
- **~540 vocabulary cards** with Chinese · pinyin · part of speech · English
- **~330 example sentences** drawn from the dialogues
- **~400 "read & write" characters** (读写字) as character cards
- Three study modes per lesson · keyboard-first · paper-style design · light / dark themes

## Files

```
chinese-flashcards/
├─ index.html              ← the app
├─ assets/
│   ├─ styles.css          ← design system + components
│   └─ app.js              ← hash router, deck logic, localStorage
├─ data/
│   └─ lessons.json        ← all 20 lessons' content
├─ docs/
│   └─ DESIGN.md           ← design system + handoff notes
└─ .claude/
    └─ launch.json         ← preview-tool config (safe to ignore)
```

## Keyboard

| Key | Action |
| --- | --- |
| `Space` / `Enter` | Flip card |
| `→` `↓` `J` | Next card |
| `←` `↑` `K` | Previous card |
| `1` `2` `3` `4` | Grade Again / Hard / Good / Easy |
| `S` | Shuffle the deck |
| `R` | Restart the deck |

## Source

Wu Zhongwei, Gao Shunquan, Tao Lian (eds). *Ten-Level Chinese — Integrated Textbook, Level 2 / 拾级汉语 综合课本 第2级*. Beijing Language and Culture University Press, 2017.
