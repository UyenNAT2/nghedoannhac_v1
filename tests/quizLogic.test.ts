import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface QuizSong {
  id: string;
  title: string;
  mediaType: 'youtube' | 'audio';
  mediaUrl: string;
  videoId: string;
  startSeconds: number;
  category: string;
  options: string[];
  correctIndex: number;
}

interface MusicGameEngineApi {
  DEFAULT_SONGS: QuizSong[];
  DISTRACTOR_BANK: Array<{ title: string; category: string }>;
  parseMediaUrl: (url: string) => { valid: boolean; mediaType: string; videoId: string; cleanUrl: string };
  generateDistractors: (title: string, category: string, pool?: unknown[]) => { options: string[]; correctIndex: number };
  computeRoundScore: (remainingMs: number, totalMs: number, maxScore?: number) => number;
  buildRandomQuiz: (count: number, bank?: QuizSong[]) => QuizSong[];
  sanitizeSongs: (list: unknown) => QuizSong[];
}

function loadMusicEngineFromHtml(): { engine: MusicGameEngineApi; html: string } {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match && match[1], 'index.html should contain an inline <script>');

  const noop = () => {};
  const makeFakeEl = () => ({
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    appendChild: noop,
    addEventListener: noop,
    focus: noop,
    blur: noop,
    value: '',
    checked: true,
    textContent: '',
    innerHTML: '',
    offsetWidth: 100,
    pause: noop,
    play: () => Promise.resolve(),
  });

  const fakeWindow: Record<string, unknown> = {
    MusicGameEngine: null,
    AudioContext: undefined,
    webkitAudioContext: undefined,
  };

  const sandbox: Record<string, unknown> = {
    window: fakeWindow,
    document: {
      body: { dataset: {} },
      head: { appendChild: noop },
      getElementById: () => makeFakeEl(),
      createElement: () => makeFakeEl(),
      addEventListener: noop,
    },
    localStorage: {
      getItem: () => null,
      setItem: noop,
    },
    performance: { now: () => 0 },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: noop,
    navigator: {},
    setTimeout,
    clearTimeout,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    JSON,
    Promise,
  };
  fakeWindow.document = sandbox.document;

  vm.runInNewContext(match[1], sandbox);
  const engine = fakeWindow.MusicGameEngine as MusicGameEngineApi | null;
  assert.ok(engine, 'window.MusicGameEngine must be initialized');
  return { engine, html };
}

const { engine, html } = loadMusicEngineFromHtml();

test('default Grade 7 bank contains 100 unique valid songs with 4 unique options each', () => {
  assert.equal(engine.DEFAULT_SONGS.length, 100);
  const titles = new Set<string>();
  const videoIds = new Set<string>();

  for (const song of engine.DEFAULT_SONGS) {
    assert.equal(song.options.length, 4);
    assert.ok(song.correctIndex >= 0 && song.correctIndex <= 3);
    assert.equal(song.options[song.correctIndex], song.title);
    assert.match(song.videoId, /^[a-zA-Z0-9_-]{11}$/);
    const optSet = new Set(song.options.map((o) => o.toLowerCase()));
    assert.equal(optSet.size, 4, `Options must be unique for ${song.title}`);
    titles.add(song.title.toLowerCase());
    videoIds.add(song.videoId);
  }

  assert.equal(titles.size, 100);
  assert.equal(videoIds.size, 100);
});

test('UI and branding remove all Quiz.com / QUIZ.com / Slide / PIN clones', () => {
  assert.equal(/quiz\.com|quizcom/i.test(html), false);
  assert.equal(/PIN\s*828/i.test(html), false);
  assert.equal(/Slide\s+\d+\/\d+|'Slide '/i.test(html), false);
  assert.ok(html.includes('GiaiĐiệu'));
});

test('parseMediaUrl extracts YouTube IDs across all URL formats and supports MP3', () => {
  const parsedWatch = engine.parseMediaUrl('https://www.youtube.com/watch?v=AYGxpsFI-Kc&t=18s');
  assert.equal(parsedWatch.valid, true);
  assert.equal(parsedWatch.mediaType, 'youtube');
  assert.equal(parsedWatch.videoId, 'AYGxpsFI-Kc');
  assert.equal(parsedWatch.cleanUrl, 'https://www.youtube.com/watch?v=AYGxpsFI-Kc&t=18s');
  assert.equal(engine.parseMediaUrl('https://youtu.be/JAhdeizXpaQ?si=abc').videoId, 'JAhdeizXpaQ');
  assert.equal(engine.parseMediaUrl('https://www.youtube.com/shorts/ukHK1GVyr0I').videoId, 'ukHK1GVyr0I');
  assert.equal(engine.parseMediaUrl('https://www.youtube.com/embed/y7-FVnMn1fo').videoId, 'y7-FVnMn1fo');
  assert.equal(engine.parseMediaUrl('8gvtAeGTNZQ').videoId, '8gvtAeGTNZQ');

  const mp3 = engine.parseMediaUrl('https://example.com/audio/mai-truong-men-yeu.mp3');
  assert.equal(mp3.valid, true);
  assert.equal(mp3.mediaType, 'audio');
  assert.equal(mp3.videoId, '');

  assert.equal(engine.parseMediaUrl('not a valid link').valid, false);
  assert.equal(engine.parseMediaUrl('').valid, false);
});

test('generateDistractors produces 4 unique options containing the correct title', () => {
  const result = engine.generateDistractors('Mái trường mến yêu', 'hocduong');
  assert.equal(result.options.length, 4);
  assert.ok(result.correctIndex >= 0 && result.correctIndex <= 3);
  assert.equal(result.options[result.correctIndex], 'Mái trường mến yêu');

  const unique = new Set(result.options.map((o) => o.toLowerCase()));
  assert.equal(unique.size, 4);
});

test('computeRoundScore scales linearly from 1000 down to 0', () => {
  assert.equal(engine.computeRoundScore(25000, 25000, 1000), 1000);
  assert.equal(engine.computeRoundScore(12500, 25000, 1000), 500);
  assert.equal(engine.computeRoundScore(0, 25000, 1000), 0);
  assert.equal(engine.computeRoundScore(-100, 25000, 1000), 0);
});

test('buildRandomQuiz returns requested number of shuffled songs with preserved answer mapping', () => {
  const quiz = engine.buildRandomQuiz(30);
  assert.equal(quiz.length, 30);
  for (const q of quiz) {
    assert.equal(q.options.length, 4);
    assert.equal(q.options[q.correctIndex], q.title);
  }
});

test('sanitizeSongs falls back to defaults on invalid/empty data and preserves valid entries', () => {
  const fallback = engine.sanitizeSongs([]);
  assert.equal(fallback.length, 100);

  const custom = engine.sanitizeSongs([
    {
      id: 'c1',
      title: 'Bài ca lớp 7',
      mediaUrl: 'https://youtu.be/dQw4w9WgXcQ',
      startSeconds: 10,
      category: 'hocduong',
      options: ['A', 'Bài ca lớp 7', 'C', 'D'],
      correctIndex: 1,
    },
    { title: '', mediaUrl: 'bad' },
  ]);
  assert.equal(custom.length, 1);
  assert.equal(custom[0].videoId, 'dQw4w9WgXcQ');
  assert.equal(custom[0].startSeconds, 10);
});
