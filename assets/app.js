/* ============================================================
   Ten-Level Chinese — Flashcards
   Vanilla JS, single page, hash router, localStorage progress
   ============================================================ */

'use strict';

const STORAGE_KEY = 'tlc.v1';
const SETTINGS_KEY = 'tlc.settings.v1';

const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const html = String.raw;
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------------- state ---------------------- */
const state = {
  data: null,
  view: 'home',
  lessonId: null,
  mode: null,            // vocab | sentences | characters | listen | quiz
  queueType: null,       // null | 'due' | 'weak' | 'random'
  deck: [],
  index: 0,
  flipped: false,
  shuffled: false,
  finished: false,
  reviewed: new Set(),
  grades: {},            // cardKey -> grade (this session)
  audioManifest: null,   // { cardText: "file.mp3" }
  audioEl: null,         // shared HTMLAudioElement
  audioPlaying: false,   // true only while a clip/TTS is playing
  settings: loadSettings(),
  progress: loadProgress(),
  searchIndex: null,     // built once after data loads
  writer: null,          // active Hanzi Writer instance
  writerChar: null,      // currently loaded char
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return Object.assign(defaultSettings(), JSON.parse(raw));
  } catch (e) {}
  return defaultSettings();
}
function defaultSettings() {
  return { theme: 'auto', front: 'zh', size: 'l', reduceMotion: false };
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { lessons: {}, lastStudyDate: null, streak: 0 };
}
function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

/* ---------------------- bootstrap ---------------------- */
async function init() {
  applySettings();

  try {
    const r = await fetch('data/lessons.json');
    if (!r.ok) throw new Error('Could not load lessons');
    state.data = await r.json();
  } catch (e) {
    console.error(e);
    document.body.innerHTML = '<main style="padding:48px;text-align:center;font-family:system-ui">Could not load <code>data/lessons.json</code>.<br>Run a local server: <code>cd chinese-flashcards &amp;&amp; python3 -m http.server 8000</code></main>';
    return;
  }

  // Audio manifest is optional — the app still works (browser TTS) without it.
  try {
    const ar = await fetch('assets/audio/manifest.json');
    if (ar.ok) state.audioManifest = await ar.json();
  } catch (e) { state.audioManifest = null; }

  bindGlobalEvents();
  bindSettingsDialog();
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);

  bumpStreak();
}

function bumpStreak() {
  const today = new Date().toISOString().slice(0, 10);
  if (state.progress.lastStudyDate !== today) {
    const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    if (state.progress.lastStudyDate === y) state.progress.streak = (state.progress.streak || 0) + 1;
    else state.progress.streak = 1;
    state.progress.lastStudyDate = today;
    saveProgress();
  }
}

/* ---------------------- router ---------------------- */
function routeFromHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  $$('.view').forEach((v) => v.hidden = true);

  if (parts.length === 0) {
    state.view = 'home';
    $('#view-home').hidden = false;
    renderHome();
  } else if (parts[0] === 'lesson' && parts[1]) {
    state.view = 'lesson';
    state.lessonId = +parts[1];
    state.queueType = null;
    $('#view-lesson').hidden = false;
    renderLesson();
  } else if (parts[0] === 'study' && parts[1] && parts[2]) {
    state.view = 'study';
    state.lessonId = +parts[1];
    state.mode = parts[2];
    state.queueType = null;
    $('#view-study').hidden = false;
    startStudy();
  } else if (parts[0] === 'queue' && parts[1]) {
    state.view = 'study';
    state.lessonId = null;
    state.queueType = parts[1];
    state.mode = 'queue';
    $('#view-study').hidden = false;
    startStudy();
  } else {
    location.hash = '#/';
  }
  window.scrollTo(0, 0);
  closeSearchResults();
}

/* ---------------------- home view ---------------------- */
function renderHome() {
  // Update lede with REAL totals from the data file (not hardcoded numbers).
  const lede = $('#heroLede');
  if (lede && state.data.meta) {
    const m = state.data.meta;
    lede.textContent = `${m.vocab_total} words, ${m.sentence_total} example sentences, and ${m.character_total} characters from the Level 2 Integrated Textbook, organised by lesson. Front shows Chinese — flip for pinyin and English.`;
  }

  // Stats
  const stats = computeOverallStats();
  $('#statSeen').textContent  = stats.seen;
  $('#statKnown').textContent = stats.known;
  $('#statStreak').textContent = state.progress.streak || 0;

  // Quick-start chip counts
  const due  = dueCards(999).length;
  const weak = weakCards(999).length;
  $('#qsDueCount').textContent  = due;
  $('#qsWeakCount').textContent = weak;
  const qsDue  = $('#qsDue');  if (qsDue)  qsDue.classList.toggle('is-empty', due  === 0);
  const qsWeak = $('#qsWeak'); if (qsWeak) qsWeak.classList.toggle('is-empty', weak === 0);

  // Lesson grid
  const grid = $('#lessonGrid');
  grid.innerHTML = state.data.lessons.map((L) => {
    const p = lessonProgress(L.id);
    const totalCards = L.vocab.length + (L.sentences?.length || 0);
    const pct = totalCards ? Math.round((p.known / totalCards) * 100) : 0;
    return html`
      <li>
        <a href="#/lesson/${L.id}" class="lesson-card" aria-label="Lesson ${L.id}: ${escapeHTML(L.title_en)}">
          <span class="lesson-card__num">第 ${L.id} 课 · Lesson ${L.id}</span>
          <h3 class="lesson-card__zh">${escapeHTML(L.title_zh)}</h3>
          <p class="lesson-card__pinyin">${escapeHTML(L.title_pinyin)}</p>
          <p class="lesson-card__en">${escapeHTML(L.title_en)}</p>
          <span class="lesson-card__meta">
            <span><strong>${L.vocab.length}</strong> words</span>
            <span aria-hidden="true">·</span>
            <span><strong>${L.sentences?.length || 0}</strong> sentences</span>
            <span aria-hidden="true">·</span>
            <span><strong>${pct}%</strong> learned</span>
          </span>
          <span class="lesson-card__progress" aria-hidden="true"><i style="width:${pct}%"></i></span>
        </a>
      </li>
    `;
  }).join('');
}

function computeOverallStats() {
  let seen = 0, known = 0;
  for (const L of state.data.lessons) {
    const p = lessonProgress(L.id);
    seen += p.seen;
    known += p.known;
  }
  return { seen, known };
}

function lessonProgress(id) {
  const lp = state.progress.lessons[id] || {};
  const seen = Object.keys(lp).length;
  const known = Object.values(lp).filter((rec) => {
    const g = typeof rec === 'string' ? rec : rec.g;
    return g === 'good' || g === 'easy';
  }).length;
  return { seen, known };
}

/* ---------------------- SRS (very simple SM-2-ish) ---------------------- */
const DAY = 24 * 60 * 60 * 1000;
function srsRecord(cardKey, lessonId) {
  const lp = state.progress.lessons[lessonId] || {};
  const r = lp[cardKey];
  if (!r) return { g: null, ivl: 0, ease: 2.5, reps: 0, due: 0 };
  if (typeof r === 'string') return { g: r, ivl: 0, ease: 2.5, reps: 0, due: 0 };
  return Object.assign({ g: null, ivl: 0, ease: 2.5, reps: 0, due: 0 }, r);
}
function srsApply(prev, grade) {
  const now = Date.now();
  let { ivl, ease, reps } = prev;
  if (grade === 'again') {
    ivl = 0;                                  // see again very soon
    ease = Math.max(1.3, ease - 0.2);
    reps = 0;
  } else if (grade === 'hard') {
    ivl = Math.max(1, Math.round((ivl || 1) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    reps = (reps || 0) + 1;
  } else if (grade === 'good') {
    ivl = reps < 1 ? 1 : reps < 2 ? 3 : Math.round((ivl || 1) * ease);
    reps = (reps || 0) + 1;
  } else if (grade === 'easy') {
    ivl = reps < 1 ? 3 : Math.round((ivl || 2) * ease * 1.3);
    ease = ease + 0.15;
    reps = (reps || 0) + 1;
  }
  ivl = Math.min(ivl, 365);                    // cap
  const due = grade === 'again' ? now + 60_000 : now + ivl * DAY;
  return { g: grade, ivl, ease, reps, due };
}
function allCardsFlat() {
  // Lazy: build once. Includes vocab + sentences + characters.
  if (state._flat) return state._flat;
  const flat = [];
  for (const L of state.data.lessons) {
    for (let i = 0; i < L.vocab.length; i++) {
      const v = L.vocab[i];
      flat.push({
        lessonId: L.id, lessonTitle: L.title_zh, type: 'vocab',
        key: `L${L.id}.v.${i}`,
        front_zh: v.chinese, pinyin: v.pinyin, english: v.english, pos: v.pos || '',
      });
    }
    for (let i = 0; i < (L.sentences || []).length; i++) {
      const s = L.sentences[i];
      flat.push({
        lessonId: L.id, lessonTitle: L.title_zh, type: 'sentence',
        key: `L${L.id}.s.${i}`,
        front_zh: s.chinese, pinyin: s.pinyin, english: s.english, pos: '',
      });
    }
    for (let i = 0; i < (L.characters || []).length; i++) {
      const c = L.characters[i];
      flat.push({
        lessonId: L.id, lessonTitle: L.title_zh, type: 'character',
        key: `L${L.id}.c.${i}`,
        front_zh: c,
        pinyin: (L.char_pinyin || {})[c] || '',
        english: (L.char_gloss || {})[c] || '',
        pos: '',
        compounds: (L.char_compounds || {})[c] || [],
        examples: (L.char_examples || {})[c] || [],
      });
    }
  }
  state._flat = flat;
  return flat;
}
function dueCards(limit = 50) {
  const now = Date.now();
  const all = allCardsFlat();
  const out = [];
  for (const c of all) {
    const r = srsRecord(c.key, c.lessonId);
    if (r.g && r.due && r.due <= now) out.push({ ...c, _due: r.due });
  }
  out.sort((a, b) => a._due - b._due);
  return out.slice(0, limit);
}
function weakCards(limit = 30) {
  const all = allCardsFlat();
  const scored = [];
  for (const c of all) {
    const r = srsRecord(c.key, c.lessonId);
    if (!r.g) continue;
    // weakness = lower ease + recent 'again'/'hard' grades
    const penalty = r.g === 'again' ? 2 : r.g === 'hard' ? 1 : 0;
    const score = penalty - r.ease;
    if (penalty > 0 || r.ease < 2.3) scored.push({ ...c, _score: score });
  }
  scored.sort((a, b) => b._score - a._score);
  return scored.slice(0, limit);
}
function randomCards(n = 20) {
  const all = allCardsFlat();
  const picks = [];
  const used = new Set();
  while (picks.length < n && picks.length < all.length) {
    const i = Math.floor(Math.random() * all.length);
    if (!used.has(i)) { used.add(i); picks.push(all[i]); }
  }
  return picks;
}

/* ---------------------- lesson view ---------------------- */
function renderLesson() {
  const L = state.data.lessons.find((x) => x.id === state.lessonId);
  if (!L) { location.hash = '#/'; return; }

  $('#lessonNum').textContent      = `第 ${L.id} 课 · Lesson ${L.id}`;
  $('#lessonTitle').textContent    = L.title_zh;
  $('#lessonPinyin').textContent   = L.title_pinyin;
  $('#lessonEnglish').textContent  = L.title_en;

  $('#cntVocab').textContent       = L.vocab.length;
  $('#cntSentences').textContent   = L.sentences?.length || 0;
  $('#cntChars').textContent       = L.characters?.length || 0;

  // hook mode cards
  $$('.mode-card').forEach((el) => {
    const m = el.dataset.mode;
    el.href = `#/study/${L.id}/${m}`;
  });

  // vocab table
  const tbl = $('#vocabTable');
  tbl.innerHTML = L.vocab.map((v) => html`
    <div class="vocab-row" role="listitem">
      <span class="vocab-row__zh">${escapeHTML(v.chinese)}</span>
      <span class="vocab-row__py">${escapeHTML(v.pinyin)}</span>
      <span class="vocab-row__pos">${escapeHTML(v.pos || '')}</span>
      <span class="vocab-row__en">${escapeHTML(v.english)}</span>
    </div>
  `).join('');
}

/* ---------------------- study view ---------------------- */
function startStudy() {
  let backHref = '#/';
  let label = '';
  if (state.queueType) {
    state.deck = buildQueueDeck(state.queueType);
    label = queueLabel(state.queueType);
    $('#studyLessonLabel').textContent = label;
    $('#studyModeLabel').textContent = `${state.deck.length} cards across all lessons`;
  } else {
    const L = state.data.lessons.find((x) => x.id === state.lessonId);
    if (!L) { location.hash = '#/'; return; }
    state.deck = buildDeck(L, state.mode);
    backHref = `#/lesson/${L.id}`;
    $('#studyLessonLabel').textContent = `Lesson ${L.id} · ${L.title_zh}`;
    $('#studyModeLabel').textContent = modeLabel(state.mode);
  }
  if (state.shuffled) shuffleInPlace(state.deck);

  $('#studyBack').href = backHref;
  $('#finishedBack').href = backHref;
  $('#studyTotal').textContent = state.deck.length;

  state.index = 0;
  state.flipped = false;
  state.finished = false;
  state.reviewed.clear();
  state.grades = {};

  // Show / hide UI bits specific to certain modes
  const isQuiz = state.mode === 'quiz';
  $('#quizPanel').hidden = !isQuiz;

  renderCard();
}
function modeLabel(m) {
  return ({
    vocab: 'Vocabulary',
    sentences: 'Sentences',
    characters: 'Characters · 读写字',
    listen: 'Listening drill',
    quiz: 'Type-in quiz',
  })[m] || m;
}
function queueLabel(t) {
  return ({ due: 'Due today', weak: 'Weakest cards', random: 'Random mix' })[t] || 'Queue';
}
function buildQueueDeck(type) {
  let cards = [];
  if (type === 'due')    cards = dueCards(60);
  if (type === 'weak')   cards = weakCards(30);
  if (type === 'random') cards = randomCards(20);
  // Cards already match the shape we use; ensure key + type fields are set.
  return cards.map((c) => ({ ...c }));
}
function buildDeck(L, mode) {
  if (mode === 'vocab') {
    return L.vocab.map((v, i) => ({
      key: `L${L.id}.v.${i}`,
      type: 'vocab',
      front_zh: v.chinese,
      pinyin: v.pinyin,
      english: v.english,
      pos: v.pos || '',
    }));
  }
  if (mode === 'sentences') {
    return (L.sentences || []).map((s, i) => ({
      key: `L${L.id}.s.${i}`,
      type: 'sentence',
      front_zh: s.chinese,
      pinyin: s.pinyin,
      english: s.english,
      pos: '',
    }));
  }
  if (mode === 'characters') {
    const compounds = L.char_compounds || {};
    const examples  = L.char_examples  || {};
    const charPy    = L.char_pinyin    || {};
    const charGloss = L.char_gloss     || {};
    return (L.characters || []).map((c, i) => {
      const comps = compounds[c] || [];
      const exs   = examples[c]  || [];
      return {
        key: `L${L.id}.c.${i}`,
        type: 'character',
        lessonId: L.id,
        front_zh: c,
        pinyin: charPy[c] || '',
        english: charGloss[c] || '',
        pos: '',
        compounds: comps,
        examples: exs,
      };
    });
  }
  if (mode === 'listen') {
    // Audio-first deck = vocab + sentences from this lesson (the rich material).
    const deck = [];
    L.vocab.forEach((v, i) => deck.push({
      key: `L${L.id}.v.${i}`, type: 'vocab', lessonId: L.id,
      front_zh: v.chinese, pinyin: v.pinyin, english: v.english, pos: v.pos || '',
    }));
    (L.sentences || []).forEach((s, i) => deck.push({
      key: `L${L.id}.s.${i}`, type: 'sentence', lessonId: L.id,
      front_zh: s.chinese, pinyin: s.pinyin, english: s.english, pos: '',
    }));
    return deck;
  }
  if (mode === 'quiz') {
    // Vocab is the cleanest target for type-in pinyin quiz.
    return L.vocab.map((v, i) => ({
      key: `L${L.id}.v.${i}`, type: 'vocab', lessonId: L.id,
      front_zh: v.chinese, pinyin: v.pinyin, english: v.english, pos: v.pos || '',
    }));
  }
  return [];
}

function renderCard() {
  $('#finished').hidden = true;
  $('#cardStage').style.display = '';
  $('.action-row').style.display = '';
  $('.navrow').style.display = '';

  if (state.deck.length === 0) {
    $('#cardChinese').textContent = '—';
    $('#cardPinyin').textContent = '';
    $('#cardEnglish').textContent = 'This mode has no cards in this lesson yet.';
    $('#cardPos').textContent = '';
    $('#studyPos').textContent = 0;
    $('#progressBar').style.width = '0%';
    return;
  }

  stopAudio();   // never let a previous clip bleed into the next card

  const card = state.deck[state.index];
  const cardEl = $('#card');
  cardEl.classList.remove(
    'is-flipped', 'is-marked-again', 'is-marked-good',
    'card--sentence', 'card--character', 'card--listen', 'card--quiz',
    'card--front-en',
    'card--size-m', 'card--size-l', 'card--size-xl'
  );
  cardEl.classList.add(`card--size-${state.settings.size}`);

  // Mode-driven layout classes (listen/quiz can apply on top of card.type).
  const isListen = state.mode === 'listen';
  const isQuiz   = state.mode === 'quiz';
  if (isListen) cardEl.classList.add('card--listen');
  if (isQuiz)   cardEl.classList.add('card--quiz');

  if (!isListen && !isQuiz) {
    if (card.type === 'character') {
      cardEl.classList.add('card--character');
    } else if (card.type === 'sentence' || (card.type === 'vocab' && card.front_zh.length > 4)) {
      cardEl.classList.add('card--sentence');
    }
  }
  cardEl.setAttribute('aria-pressed', 'false');
  state.flipped = false;

  // --- Front content ---
  $('#cardListen').hidden = !isListen;
  $('#cardChinese').hidden = false;
  if (isListen) {
    // Hide the Chinese on the front; show a "Listen" placeholder.
    $('#cardChinese').hidden = true;
    $('#cardHint').textContent = 'Tap card or press Space to reveal';
  } else if (isQuiz) {
    // Show English as the prompt; ask for pinyin below the card.
    $('#cardChinese').textContent = card.english || '—';
    $('#cardHint').textContent = 'Type below — tap card to reveal';
  } else {
    $('#cardHint').textContent = 'Tap card or press Space to flip';
  }

  // --- Back content ---
  if (card.type === 'character' && !isListen && !isQuiz) {
    $('#cardChinese').textContent = card.front_zh;
    $('#cardPinyin').textContent  = card.pinyin || '';
    $('#cardEnglish').innerHTML   = renderCharBack(card);
    $('#cardPos').textContent = '读写字';
  } else if (isListen) {
    // Back shows everything: hanzi (big), pinyin, English
    $('#cardPinyin').textContent  = card.pinyin || '';
    $('#cardEnglish').innerHTML   =
      `<div class="listen-back__zh">${escapeHTML(card.front_zh)}</div>
       <div class="listen-back__en">${escapeHTML(card.english || '')}</div>`;
    $('#cardPos').textContent = card.pos || '';
  } else if (isQuiz) {
    // Back shows the answer: hanzi + pinyin
    $('#cardPinyin').textContent  = card.pinyin || '';
    $('#cardEnglish').innerHTML   =
      `<div class="listen-back__zh">${escapeHTML(card.front_zh)}</div>
       <div class="listen-back__en">${escapeHTML(card.english || '')}</div>`;
    $('#cardPos').textContent = card.pos || '';
    resetQuiz(card);
  } else {
    const showZhFirst = state.settings.front === 'zh';
    if (showZhFirst) {
      $('#cardChinese').textContent = card.front_zh;
      $('#cardPinyin').textContent  = card.pinyin || '';
      $('#cardEnglish').textContent = card.english || '';
    } else {
      cardEl.classList.add('card--front-en');
      $('#cardChinese').textContent = card.english || '—';
      $('#cardPinyin').textContent  = card.pinyin || '';
      $('#cardEnglish').textContent = card.front_zh;
    }
    $('#cardPos').textContent = card.pos || '';
  }

  $('#studyPos').textContent = state.index + 1;
  const pct = ((state.reviewed.size) / state.deck.length) * 100;
  $('#progressBar').style.width = pct + '%';

  // Audio button is always available — Chinese is always speakable.
  const ab = $('#audioBtn');
  if (ab) ab.disabled = false;
  setAudioBtnState(false);
}

/* ---------------------- audio (hybrid) ---------------------- */

// One reusable <audio> element. Playback is always triggered by a
// direct button/key press — itself the user gesture every browser
// requires — so no autoplay-unlock workaround is needed.
function getAudioEl() {
  if (!state.audioEl) {
    state.audioEl = new Audio();
    state.audioEl.preload = 'auto';
  }
  return state.audioEl;
}

function currentSpeakText() {
  const card = state.deck[state.index];
  if (!card) return '';
  // Always speak the Chinese, even in inverted (English-front) mode.
  return card.front_zh || '';
}

function setAudioBtnState(playing) {
  const ab = $('#audioBtn');
  if (!ab) return;
  ab.classList.remove('is-error');
  ab.classList.toggle('is-playing', !!playing);
  ab.setAttribute('aria-label', playing ? 'Stop audio' : 'Play pronunciation');
  const lbl = $('#audioLabel');
  if (lbl) lbl.textContent = playing ? 'Playing — tap to stop' : 'Play pronunciation';
}

let _audioErrTimer = null;
function flashAudioUnavailable() {
  const ab = $('#audioBtn');
  const lbl = $('#audioLabel');
  if (!ab || !lbl) return;
  state.audioPlaying = false;
  ab.classList.remove('is-playing');
  ab.classList.add('is-error');
  lbl.textContent = 'Audio unavailable here';
  clearTimeout(_audioErrTimer);
  _audioErrTimer = setTimeout(() => {
    ab.classList.remove('is-error');
    lbl.textContent = 'Play pronunciation';
  }, 2000);
}

function stopAudio() {
  state.audioPlaying = false;
  if (state.audioEl) { state.audioEl.pause(); state.audioEl.currentTime = 0; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  setAudioBtnState(false);
}

function speakFallback(text) {
  if (!('speechSynthesis' in window) || !text) { flashAudioUnavailable(); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.9;
    const v = window.speechSynthesis.getVoices()
      .find((x) => /zh(-|_)?CN/i.test(x.lang) || /Chinese/i.test(x.name));
    if (v) u.voice = v;
    let started = false;
    u.onstart = () => { started = true; };
    u.onend = () => { state.audioPlaying = false; setAudioBtnState(false); };
    u.onerror = () => { state.audioPlaying = false; flashAudioUnavailable(); };
    state.audioPlaying = true;
    setAudioBtnState(true);
    window.speechSynthesis.speak(u);
    // If nothing actually started (no usable voice), tell the user.
    setTimeout(() => {
      if (!started && !window.speechSynthesis.speaking) {
        state.audioPlaying = false;
        flashAudioUnavailable();
      }
    }, 700);
  } catch (e) { state.audioPlaying = false; flashAudioUnavailable(); }
}

function playCardAudio() {
  const text = currentSpeakText();
  if (!text) return;

  // Press again while playing → stop (toggle).
  if (state.audioPlaying) { stopAudio(); return; }

  const file = state.audioManifest && state.audioManifest[text];
  if (file) {
    const a = getAudioEl();
    a.src = `assets/audio/${file}`;
    a.onended = () => { state.audioPlaying = false; setAudioBtnState(false); };
    a.onerror = () => { state.audioPlaying = false; speakFallback(text); }; // missing → TTS
    state.audioPlaying = true;
    setAudioBtnState(true);
    const p = a.play();
    if (p && p.catch) p.catch(() => { state.audioPlaying = false; speakFallback(text); });
  } else {
    speakFallback(text);                            // no pre-gen clip → TTS
  }
}

function renderCharBack(card) {
  // pinyin is already rendered in #cardPinyin — don't duplicate it here
  const compounds = (card.compounds || []).slice(0, 4);
  const examples  = (card.examples  || []).slice(0, 2);

  // Primary: the character's own English meaning.
  let html = card.english
    ? `<div class="char-back__meaning">${escapeHTML(card.english)}</div>`
    : '';

  if (compounds.length) {
    html += `<div class="char-back__section">
      <div class="char-back__label">Appears in</div>
      <ul class="char-back__list">${compounds.map((c) => `
        <li>
          <span class="char-back__zh">${escapeHTML(c.word)}</span>
          <span class="char-back__alt">${escapeHTML(c.pinyin)} — ${escapeHTML(c.english)}</span>
        </li>`).join('')}
      </ul>
    </div>`;
  }

  if (examples.length && !compounds.length) {
    // Only show examples when there are no compounds, to keep the card tidy.
    html += `<div class="char-back__section">
      <div class="char-back__label">In context</div>
      <ul class="char-back__list">${examples.map((e) => `
        <li>
          <span class="char-back__zh">${escapeHTML(e.sentence)}</span>
          <span class="char-back__alt">${escapeHTML(e.english)}</span>
        </li>`).join('')}
      </ul>
    </div>`;
  }

  if (!compounds.length && !examples.length) {
    html += `<div class="char-back__section char-back__section--empty">
      <em>读写字 — introduced here for reading &amp; writing practice.</em>
    </div>`;
  }
  // Practice-writing button for single characters (Hanzi Writer)
  html += `<div class="char-back__write">
    <button type="button" class="btn btn--ghost char-back__writebtn"
            data-write-char="${escapeHTML(card.front_zh)}"
            data-write-py="${escapeHTML(card.pinyin || '')}"
            data-write-en="${escapeHTML(card.english || '')}">
      ✍︎ Practice writing
    </button>
  </div>`;
  return html;
}

/* ---------------------- quiz mode ---------------------- */

// Strip tone marks (and "ü"→"u") + lowercase + collapse spaces.
function normPinyin(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')           // diacritics
    .replace(/ü|ü/g, 'u')
    .replace(/[^a-z0-9]+/g, ' ')                // punctuation/ellipsis → space
    .trim();
}
function resetQuiz(card) {
  if (state.mode !== 'quiz') return;
  const inp = $('#quizInput');
  const fb  = $('#quizFeedback');
  $('#quizPanel').hidden = false;
  if (inp) { inp.value = ''; inp.disabled = false; inp.classList.remove('is-wrong','is-right'); }
  if (fb) { fb.textContent = ''; fb.className = 'quiz-panel__feedback'; }
  $('#quizPrompt').textContent = 'Type the pinyin (tones optional):';
  setTimeout(() => inp && inp.focus(), 30);
}
function checkQuiz(e) {
  if (e) e.preventDefault();
  if (state.mode !== 'quiz') return;
  const card = state.deck[state.index];
  if (!card) return;
  const inp = $('#quizInput');
  const fb  = $('#quizFeedback');
  const guess = normPinyin(inp.value);
  const truth = normPinyin(card.pinyin);
  if (!guess) { inp.focus(); return; }
  if (guess === truth) {
    inp.classList.add('is-right');
    fb.className = 'quiz-panel__feedback is-right';
    fb.textContent = `✓  ${card.pinyin} — ${card.english}`;
    // Auto-reveal the answer on the card
    if (!state.flipped) flipCard();
  } else {
    inp.classList.add('is-wrong');
    fb.className = 'quiz-panel__feedback is-wrong';
    fb.innerHTML = `✗  You typed <strong>${escapeHTML(inp.value)}</strong> — expected <strong>${escapeHTML(card.pinyin)}</strong>`;
  }
  inp.disabled = true;
}

/* ---------------------- Hanzi Writer ---------------------- */

function openWriter(ch, py, en) {
  const dlg = $('#writerDialog');
  if (!dlg) return;
  $('#writerChar').textContent = ch;
  $('#writerSubtitle').textContent = [py, en].filter(Boolean).join(' · ');
  $('#writerStatus').textContent = 'Tap Show strokes to watch, or Trace to practice.';
  const stage = $('#writerStage');
  stage.innerHTML = '';
  state.writerChar = ch;
  state.writer = null;

  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', 'open');

  // Defer instantiation slightly so the modal sizes correctly first.
  setTimeout(() => initWriter(ch), 80);
}
function initWriter(ch) {
  if (!window.HanziWriter) {
    $('#writerStatus').textContent = 'Loading stroke-order library…';
    // Retry after the CDN script loads
    let tries = 0;
    const iv = setInterval(() => {
      if (window.HanziWriter) { clearInterval(iv); initWriter(ch); }
      else if (++tries > 30) { clearInterval(iv); $('#writerStatus').textContent = 'Could not load stroke data. Check your connection.'; }
    }, 200);
    return;
  }
  // Hanzi Writer accepts colors as literal SVG values — CSS vars don't work
  // inside SVG fill/stroke attributes, so use concrete colors.
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (document.documentElement.getAttribute('data-theme') !== 'light'
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  try {
    state.writer = window.HanziWriter.create('writerStage', ch, {
      width: 280,
      height: 280,
      padding: 12,
      showOutline: true,
      showCharacter: true,
      strokeAnimationSpeed: 1,
      delayBetweenStrokes: 120,
      drawingWidth: 30,
      strokeColor:    isDark ? '#F0EBDD' : '#1B1A18',
      radicalColor:   '#B43A2E',
      outlineColor:   isDark ? 'rgba(240,235,221,0.25)' : 'rgba(0,0,0,0.18)',
      highlightColor: '#B43A2E',
      drawingColor:   isDark ? '#F0EBDD' : '#1B1A18',
      onLoadCharDataSuccess: () => { $('#writerStatus').textContent = 'Tap Show strokes to watch, or Trace to practice.'; },
      onLoadCharDataError: () => { $('#writerStatus').textContent = `No stroke data for "${ch}" — sorry.`; },
    });
  } catch (e) {
    $('#writerStatus').textContent = 'Could not start writing practice.';
  }
}
function closeWriter() {
  const dlg = $('#writerDialog');
  if (!dlg) return;
  if (state.writer && typeof state.writer.cancelQuiz === 'function') {
    try { state.writer.cancelQuiz(); } catch (e) {}
  }
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
  state.writer = null;
  state.writerChar = null;
  $('#writerStage').innerHTML = '';
}

function flipCard() {
  if (!state.deck.length) return;
  state.flipped = !state.flipped;
  const c = $('#card');
  c.classList.toggle('is-flipped', state.flipped);
  c.setAttribute('aria-pressed', String(state.flipped));
}

function grade(g) {
  if (!state.deck.length) return;
  const card = state.deck[state.index];
  state.grades[card.key] = g;
  state.reviewed.add(card.key);

  // Persist with SRS schedule. Cards from cross-lesson queues carry their
  // own lessonId; in normal study we fall back to state.lessonId.
  const lessonId = card.lessonId || state.lessonId;
  if (lessonId != null) {
    const lp = state.progress.lessons[lessonId] || {};
    const prev = srsRecord(card.key, lessonId);
    lp[card.key] = srsApply(prev, g);
    state.progress.lessons[lessonId] = lp;
    saveProgress();
    state._flat = null;          // invalidate flat cache (counts may change)
  }

  const cEl = $('#card');
  if (g === 'again') cEl.classList.add('is-marked-again');
  if (g === 'good' || g === 'easy') cEl.classList.add('is-marked-good');

  setTimeout(() => nextCard(/*afterGrade=*/true), 220);
}

function nextCard(afterGrade) {
  if (!state.deck.length || state.finished) return;
  if (state.index < state.deck.length - 1) {
    state.index++;
    renderCard();
  } else if (afterGrade && state.reviewed.size >= state.deck.length) {
    showFinished();
  } else {
    state.index = state.deck.length - 1;
  }
}
function prevCard() {
  if (state.finished) return;
  if (state.index > 0) {
    state.index--;
    renderCard();
  }
}

function showFinished() {
  state.finished = true;
  const total = state.deck.length;
  const known = Object.values(state.grades).filter((g) => g === 'good' || g === 'easy').length;
  const hard  = Object.values(state.grades).filter((g) => g === 'hard').length;
  const again = Object.values(state.grades).filter((g) => g === 'again').length;
  $('#cardStage').style.display = 'none';
  $('.action-row').style.display = 'none';
  $('.navrow').style.display = 'none';
  $('#finished').hidden = false;
  $('#finishedStats').textContent =
    `${known} good · ${hard} hard · ${again} again — out of ${total} cards.`;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ---------------------- events ---------------------- */
function bindGlobalEvents() {
  $('#card').addEventListener('click', flipCard);

  $('#audioBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    playCardAudio();
  });

  $('#btnPrev').addEventListener('click', prevCard);
  $('#btnNext').addEventListener('click', () => nextCard(false));

  $('#btnShuffle').addEventListener('click', (e) => {
    state.shuffled = !state.shuffled;
    e.currentTarget.setAttribute('aria-pressed', String(state.shuffled));
    if (state.view === 'study') {
      // reshuffle current deck and restart
      shuffleInPlace(state.deck);
      state.index = 0;
      state.finished = false;
      state.reviewed.clear();
      state.grades = {};
      renderCard();
    }
  });

  $('#btnReset').addEventListener('click', () => {
    state.index = 0;
    state.finished = false;
    state.reviewed.clear();
    state.grades = {};
    renderCard();
  });

  $('#btnAgain').addEventListener('click', () => grade('again'));
  $('#btnHard').addEventListener('click', () => grade('hard'));
  $('#btnGood').addEventListener('click', () => grade('good'));
  $('#btnEasy').addEventListener('click', () => grade('easy'));

  $('#finishedRestart').addEventListener('click', () => {
    state.index = 0;
    state.finished = false;
    state.reviewed.clear();
    state.grades = {};
    if (state.shuffled) shuffleInPlace(state.deck);
    renderCard();
  });

  // Quiz: form submit checks the answer
  const quizForm = $('#quizForm');
  if (quizForm) quizForm.addEventListener('submit', checkQuiz);

  // Delegation: "Practice writing" button on character card back
  $('#cardEnglish').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-write-char]');
    if (!btn) return;
    e.stopPropagation();
    openWriter(btn.dataset.writeChar, btn.dataset.writePy, btn.dataset.writeEn);
  });

  // Writer dialog controls
  const wDlg = $('#writerDialog');
  if (wDlg) {
    $('#writerAnimate').addEventListener('click', () => {
      if (!state.writer) return;
      try { state.writer.cancelQuiz(); } catch (e) {}
      $('#writerStatus').textContent = 'Watch the strokes…';
      state.writer.animateCharacter({ onComplete: () => { $('#writerStatus').textContent = 'Now try tracing it.'; } });
    });
    $('#writerQuiz').addEventListener('click', () => {
      if (!state.writer) return;
      $('#writerStatus').textContent = 'Trace each stroke in order…';
      state.writer.quiz({
        showHintAfterMisses: 3,
        onMistake: () => { $('#writerStatus').textContent = 'Almost — try that stroke again.'; },
        onCorrectStroke: ({ strokesRemaining }) => {
          $('#writerStatus').textContent = strokesRemaining > 0
            ? `${strokesRemaining} stroke${strokesRemaining === 1 ? '' : 's'} to go.`
            : 'Last stroke!';
        },
        onComplete: ({ totalMistakes }) => {
          $('#writerStatus').textContent = totalMistakes === 0
            ? '✓ Perfect — no mistakes.'
            : `✓ Done. ${totalMistakes} mistake${totalMistakes === 1 ? '' : 's'}.`;
        },
      });
    });
    $('#writerClose').addEventListener('click', closeWriter);
    $('#writerDone').addEventListener('click', closeWriter);
    wDlg.addEventListener('cancel', (e) => { e.preventDefault(); closeWriter(); });
    wDlg.addEventListener('click', (e) => {
      // click on backdrop (the dialog element itself, not its inner content)
      if (e.target === wDlg) closeWriter();
    });
  }

  // Search
  bindSearch();

  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  // Global: "/" focuses search from anywhere
  if (e.key === '/' && !e.target.matches('input, textarea, [contenteditable]')) {
    e.preventDefault();
    const inp = $('#searchInput');
    if (inp) inp.focus();
    return;
  }
  // Esc closes search results
  if (e.key === 'Escape') {
    if (!$('#searchResults').hidden) { closeSearchResults(); return; }
  }
  if (state.view !== 'study') return;
  if (e.target.matches('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter') { e.preventDefault(); flipCard(); return; }
  if (k === 'arrowright' || k === 'arrowdown' || k === 'j') { e.preventDefault(); nextCard(false); return; }
  if (k === 'arrowleft'  || k === 'arrowup'   || k === 'k') { e.preventDefault(); prevCard(); return; }
  if (k === '1') { grade('again'); return; }
  if (k === '2') { grade('hard'); return; }
  if (k === '3') { grade('good'); return; }
  if (k === '4') { grade('easy'); return; }
  if (k === 'p') { e.preventDefault(); playCardAudio(); return; }
  if (k === 's') { $('#btnShuffle').click(); return; }
  if (k === 'r') { $('#btnReset').click(); return; }
}

/* ---------------------- search ---------------------- */
function buildSearchIndex() {
  // Lightweight: each entry stores searchable lowercase text + a route.
  const idx = [];
  for (const L of state.data.lessons) {
    for (let i = 0; i < L.vocab.length; i++) {
      const v = L.vocab[i];
      idx.push({
        zh: v.chinese, py: v.pinyin, en: v.english,
        sub: `Lesson ${L.id} · ${L.title_zh}`,
        route: `#/study/${L.id}/vocab`,
        kind: 'word',
        haystack: (v.chinese + ' ' + v.pinyin + ' ' + v.english).toLowerCase() + ' ' + normPinyin(v.pinyin),
      });
    }
    for (let i = 0; i < (L.sentences || []).length; i++) {
      const s = L.sentences[i];
      idx.push({
        zh: s.chinese, py: s.pinyin, en: s.english,
        sub: `Lesson ${L.id} · ${L.title_zh}`,
        route: `#/study/${L.id}/sentences`,
        kind: 'sentence',
        haystack: (s.chinese + ' ' + s.pinyin + ' ' + s.english).toLowerCase() + ' ' + normPinyin(s.pinyin),
      });
    }
    for (const c of (L.characters || [])) {
      const py = (L.char_pinyin || {})[c] || '';
      const en = (L.char_gloss || {})[c] || '';
      idx.push({
        zh: c, py, en,
        sub: `Lesson ${L.id} · 读写字`,
        route: `#/study/${L.id}/characters`,
        kind: 'hanzi',
        haystack: (c + ' ' + py + ' ' + en).toLowerCase() + ' ' + normPinyin(py),
      });
    }
  }
  state.searchIndex = idx;
}
function bindSearch() {
  const inp = $('#searchInput');
  const out = $('#searchResults');
  const btn = $('#searchBtn');
  if (!inp || !out) return;
  if (btn) btn.addEventListener('click', () => { inp.focus(); });
  inp.addEventListener('input', () => doSearch(inp.value));
  inp.addEventListener('focus', () => { if (inp.value.trim()) doSearch(inp.value); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { inp.value = ''; closeSearchResults(); inp.blur(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = out.querySelector('.searchresult');
      if (first) first.click();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = out.querySelector('.searchresult');
      if (first) first.focus();
    }
  });
  // Click outside closes
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.topbar__search') && !e.target.closest('#searchBtn')) {
      closeSearchResults();
    }
  });
}
function closeSearchResults() {
  const out = $('#searchResults');
  if (out) { out.hidden = true; out.innerHTML = ''; }
}
function doSearch(q) {
  const out = $('#searchResults');
  q = String(q || '').trim().toLowerCase();
  if (!q) { closeSearchResults(); return; }
  if (!state.searchIndex) buildSearchIndex();
  const nq = normPinyin(q);
  const hits = [];
  for (const it of state.searchIndex) {
    if (it.haystack.includes(q) || (nq && it.haystack.includes(nq))) {
      hits.push(it);
      if (hits.length >= 25) break;
    }
  }
  if (!hits.length) {
    out.hidden = false;
    out.innerHTML = `<div class="searchresult searchresult--empty">No matches for "${escapeHTML(q)}".</div>`;
    return;
  }
  out.hidden = false;
  out.innerHTML = hits.map((h) => `
    <a class="searchresult searchresult--${h.kind}" href="${h.route}" tabindex="0">
      <span class="searchresult__zh">${escapeHTML(h.zh)}</span>
      <span class="searchresult__py">${escapeHTML(h.py)}</span>
      <span class="searchresult__en">${escapeHTML(h.en)}</span>
      <span class="searchresult__sub">${escapeHTML(h.sub)}</span>
    </a>
  `).join('');
}

/* ---------------------- settings dialog ---------------------- */
function bindSettingsDialog() {
  const dlg = $('#settingsDialog');
  $('#settingsBtn').addEventListener('click', () => {
    $('#setTheme').value         = state.settings.theme;
    $('#setFront').value         = state.settings.front;
    $('#setSize').value          = state.settings.size;
    $('#setReduceMotion').checked = !!state.settings.reduceMotion;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', 'open');
  });

  $('#setTheme').addEventListener('change', (e) => { state.settings.theme = e.target.value; applySettings(); saveSettings(); });
  $('#setFront').addEventListener('change', (e) => { state.settings.front = e.target.value; saveSettings(); if (state.view === 'study') renderCard(); });
  $('#setSize').addEventListener('change', (e) => { state.settings.size = e.target.value; saveSettings(); if (state.view === 'study') renderCard(); });
  $('#setReduceMotion').addEventListener('change', (e) => { state.settings.reduceMotion = e.target.checked; saveSettings(); applySettings(); });

  $('#setResetProgress').addEventListener('click', () => {
    if (!confirm('Reset all progress and grades? This cannot be undone.')) return;
    state.progress = { lessons: {}, lastStudyDate: null, streak: 0 };
    saveProgress();
    if (state.view === 'home') renderHome();
  });
}

function applySettings() {
  const html = document.documentElement;
  if (state.settings.theme === 'dark') html.setAttribute('data-theme', 'dark');
  else if (state.settings.theme === 'light') html.setAttribute('data-theme', 'light');
  else html.removeAttribute('data-theme');

  if (state.settings.reduceMotion) html.setAttribute('data-motion', 'reduce');
  else html.removeAttribute('data-motion');
}

/* ---------------------- go ---------------------- */
document.addEventListener('DOMContentLoaded', init);
