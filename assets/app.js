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
  mode: null,            // vocab | sentences | characters
  deck: [],
  index: 0,
  flipped: false,
  shuffled: false,
  finished: false,
  reviewed: new Set(),
  grades: {},            // cardKey -> grade
  audioManifest: null,   // { cardText: "file.mp3" }
  audioEl: null,         // shared HTMLAudioElement
  audioUnlocked: false,  // set true after first user gesture
  audioPlaying: false,   // true only while a REAL clip/TTS is playing
  settings: loadSettings(),
  progress: loadProgress(),
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return Object.assign(defaultSettings(), JSON.parse(raw));
  } catch (e) {}
  return defaultSettings();
}
function defaultSettings() {
  return { theme: 'auto', front: 'zh', size: 'l', reduceMotion: false, autoplay: false };
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
    $('#view-lesson').hidden = false;
    renderLesson();
  } else if (parts[0] === 'study' && parts[1] && parts[2]) {
    state.view = 'study';
    state.lessonId = +parts[1];
    state.mode = parts[2];
    $('#view-study').hidden = false;
    startStudy();
  } else {
    location.hash = '#/';
  }
  window.scrollTo(0, 0);
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
  const known = Object.values(lp).filter((g) => g === 'good' || g === 'easy').length;
  return { seen, known };
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
  const L = state.data.lessons.find((x) => x.id === state.lessonId);
  if (!L) { location.hash = '#/'; return; }

  state.deck = buildDeck(L, state.mode);
  if (state.shuffled) shuffleInPlace(state.deck);

  $('#studyLessonLabel').textContent = `Lesson ${L.id} · ${L.title_zh}`;
  $('#studyModeLabel').textContent = modeLabel(state.mode);
  $('#studyBack').href = `#/lesson/${L.id}`;
  $('#finishedBack').href = `#/lesson/${L.id}`;
  $('#studyTotal').textContent = state.deck.length;

  state.index = 0;
  state.flipped = false;
  state.finished = false;
  state.reviewed.clear();
  state.grades = {};

  renderCard();
}
function modeLabel(m) {
  return { vocab: 'Vocabulary', sentences: 'Sentences', characters: 'Characters · 读写字' }[m] || m;
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
    return (L.characters || []).map((c, i) => {
      const comps = compounds[c] || [];
      const exs   = examples[c]  || [];
      return {
        key: `L${L.id}.c.${i}`,
        type: 'character',
        front_zh: c,
        pinyin: charPy[c] || '',
        english: '',          // character cards have a custom back; left blank
        pos: '',
        compounds: comps,
        examples: exs,
      };
    });
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
    'card--sentence', 'card--character',
    'card--front-en',
    'card--size-m', 'card--size-l', 'card--size-xl'
  );
  cardEl.classList.add(`card--size-${state.settings.size}`);
  if (card.type === 'character') {
    cardEl.classList.add('card--character');
  } else if (card.type === 'sentence' || (card.type === 'vocab' && card.front_zh.length > 4)) {
    cardEl.classList.add('card--sentence');
  }
  cardEl.setAttribute('aria-pressed', 'false');
  state.flipped = false;

  // Character cards: custom back with compounds & examples (always Chinese-front).
  if (card.type === 'character') {
    $('#cardChinese').textContent = card.front_zh;
    $('#cardPinyin').textContent  = card.pinyin || '';
    $('#cardEnglish').innerHTML   = renderCharBack(card);
    $('#cardPos').textContent = '读写字';
  } else {
    const showZhFirst = state.settings.front === 'zh';
    if (showZhFirst) {
      $('#cardChinese').textContent = card.front_zh;
      $('#cardPinyin').textContent  = card.pinyin || '';
      $('#cardEnglish').textContent = card.english || '';
    } else {
      // Don't force English into the giant serif slot — swap roles & style.
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

  if (state.settings.autoplay) playCardAudio();
}

/* ---------------------- audio (hybrid) ---------------------- */

// Tiny silent WAV — used once to "unlock" the audio element inside a
// real user gesture so later programmatic .play() calls are allowed
// (iOS Safari / mobile Chrome autoplay policy).
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function getAudioEl() {
  if (!state.audioEl) {
    state.audioEl = new Audio();
    state.audioEl.preload = 'auto';
  }
  return state.audioEl;
}

// Called on the very first user gesture anywhere on the page.
function unlockAudio() {
  if (state.audioUnlocked) return;
  state.audioUnlocked = true;

  const a = getAudioEl();
  try {
    a.muted = true;
    a.src = SILENT_WAV;
    const p = a.play();
    if (p && p.then) {
      p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; })
       .catch(() => { a.muted = false; });
    } else {
      a.pause(); a.muted = false;
    }
  } catch (e) { a.muted = false; }

  // Warm up speech synthesis within the gesture too (fallback path).
  if ('speechSynthesis' in window) {
    try {
      const w = new SpeechSynthesisUtterance(' ');
      w.volume = 0;
      window.speechSynthesis.speak(w);
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
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
  ab.classList.toggle('is-playing', !!playing);
  ab.setAttribute('aria-label', playing ? 'Stop audio' : 'Play pronunciation');
}

function stopAudio() {
  state.audioPlaying = false;
  if (state.audioEl) { state.audioEl.pause(); state.audioEl.currentTime = 0; }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  setAudioBtnState(false);
}

function speakFallback(text) {
  if (!('speechSynthesis' in window) || !text) { setAudioBtnState(false); return; }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 0.9;
    const pick = () => {
      const v = window.speechSynthesis.getVoices()
        .find((x) => /zh(-|_)?CN/i.test(x.lang) || /Chinese.*China/i.test(x.name));
      if (v) u.voice = v;
    };
    pick();
    u.onend = () => { state.audioPlaying = false; setAudioBtnState(false); };
    u.onerror = () => { state.audioPlaying = false; setAudioBtnState(false); };
    state.audioPlaying = true;
    setAudioBtnState(true);
    window.speechSynthesis.speak(u);
  } catch (e) { state.audioPlaying = false; setAudioBtnState(false); }
}

function playCardAudio() {
  const text = currentSpeakText();
  if (!text) return;

  // Toggle: if a REAL clip/TTS is playing, stop. (The silent unlock clip
  // does NOT set audioPlaying, so it can't false-trigger this.)
  if (state.audioPlaying) { stopAudio(); return; }

  const file = state.audioManifest && state.audioManifest[text];
  if (file) {
    const a = getAudioEl();
    a.muted = false;
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

  let html = '';

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
      <em>Practice writing this character — it's introduced for handwriting in this lesson.</em>
    </div>`;
  }
  return html;
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

  // persist per-lesson
  const lp = state.progress.lessons[state.lessonId] || {};
  lp[card.key] = g;
  state.progress.lessons[state.lessonId] = lp;
  saveProgress();

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
  // Unlock audio on the very first user interaction (any of these),
  // then stop listening. Capture phase so it runs before other handlers.
  const UNLOCK_EVENTS = ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown'];
  const unlockOnce = () => {
    unlockAudio();
    UNLOCK_EVENTS.forEach((ev) => document.removeEventListener(ev, unlockOnce, true));
  };
  UNLOCK_EVENTS.forEach((ev) => document.addEventListener(ev, unlockOnce, true));

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

  document.addEventListener('keydown', onKey);
}

function onKey(e) {
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

/* ---------------------- settings dialog ---------------------- */
function bindSettingsDialog() {
  const dlg = $('#settingsDialog');
  $('#settingsBtn').addEventListener('click', () => {
    $('#setTheme').value         = state.settings.theme;
    $('#setFront').value         = state.settings.front;
    $('#setSize').value          = state.settings.size;
    $('#setAutoplay').checked    = !!state.settings.autoplay;
    $('#setReduceMotion').checked = !!state.settings.reduceMotion;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', 'open');
  });

  $('#setTheme').addEventListener('change', (e) => { state.settings.theme = e.target.value; applySettings(); saveSettings(); });
  $('#setFront').addEventListener('change', (e) => { state.settings.front = e.target.value; saveSettings(); if (state.view === 'study') renderCard(); });
  $('#setSize').addEventListener('change', (e) => { state.settings.size = e.target.value; saveSettings(); if (state.view === 'study') renderCard(); });
  $('#setAutoplay').addEventListener('change', (e) => { state.settings.autoplay = e.target.checked; saveSettings(); });
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
