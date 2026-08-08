import type { Chord, Quality, Seventh, Tension } from '../types';

/** クオリティ → 半音インターバル */
const QUALITY_INTERVALS: Record<Quality, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  aug: [0, 4, 8],
  dim: [0, 3, 6],
};

const SEVENTH_INTERVAL: Record<Seventh, number | null> = {
  '': null,
  '7': 10,
  M7: 11,
  dim7: 9,
};

const TENSION_INTERVAL: Record<Tension, number> = {
  '9': 14,
  b9: 13,
  '#9': 15,
  '11': 17,
  '#11': 18,
  '13': 21,
  b13: 20,
};

const PITCH_CLASS: Record<string, number> = {
  C: 0, 'B#': 0, Cb: 11, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3,
  E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8,
  Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

/** キー名（末尾の m を無視）→ ピッチクラス */
export function rootOffset(name: string): number {
  return PITCH_CLASS[name.replace(/m$/, '')] ?? 0;
}

export const RELATIVE_MINOR: Record<string, string> = {
  C: 'Am', Db: 'Bbm', D: 'Bm', Eb: 'Cm', E: 'C#m', F: 'Dm',
  Gb: 'Ebm', G: 'Em', Ab: 'Fm', A: 'F#m', Bb: 'Gm', B: 'G#m',
};

const MINOR_TO_MAJOR: Record<string, string> = {
  Am: 'C', Bbm: 'Db', Bm: 'D', Cm: 'Eb', 'C#m': 'E', Dm: 'F',
  Ebm: 'Gb', Em: 'G', Fm: 'Ab', 'F#m': 'A', Gm: 'Bb', 'G#m': 'B',
};

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** キーごとの12音の表記（♯系 / ♭系の使い分け） */
const KEY_NOTE_TABLE: Record<string, string[]> = {
  C: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  Db: FLAT_NAMES,
  D: SHARP_NAMES,
  Eb: FLAT_NAMES,
  E: SHARP_NAMES,
  F: FLAT_NAMES,
  Gb: FLAT_NAMES,
  G: SHARP_NAMES,
  Ab: FLAT_NAMES,
  A: SHARP_NAMES,
  Bb: FLAT_NAMES,
  B: SHARP_NAMES,
};

/** マイナーキーは平行長調のテーブルを使う */
function noteTable(key: string): string[] {
  if (key.endsWith('m')) {
    const major = MINOR_TO_MAJOR[key];
    if (major && KEY_NOTE_TABLE[major]) return KEY_NOTE_TABLE[major];
  }
  return KEY_NOTE_TABLE[key.replace(/m$/, '')] ?? KEY_NOTE_TABLE.C;
}

export type Accidental = 'sharp' | 'flat';

/** ピッチクラス → 音名（オクターブなし） */
export function getPitchClassName(pitch: number, key: string, accidental?: Accidental): string {
  const table = accidental
    ? accidental === 'sharp'
      ? SHARP_NAMES
      : FLAT_NAMES
    : noteTable(key);
  return table[((pitch % 12) + 12) % 12];
}

/** MIDI番号 → 音名（オクターブ付き） */
export function getNoteName(midi: number, key = 'C', accidental?: Accidental): string {
  const octave = Math.floor(midi / 12) - 1;
  return getPitchClassName(midi % 12, key, accidental) + octave;
}

export function getNoteNames(midiList: number[], key = 'C', accidental?: Accidental): string[] {
  return midiList.map((m) => getNoteName(m, key, accidental));
}

/** キー名 → 主音のピッチクラス（マイナーは平行長調基準で +3） */
export function getTranspositionOffset(key: string): number {
  const isMinor = key.endsWith('m');
  return (rootOffset(key) + (isMinor ? 3 : 0)) % 12;
}

/** コードの構成音（ルートからの半音インターバル） */
export function getIntervals(chord: Chord | null | undefined): number[] {
  if (!chord || chord.isNC) return [];

  let quality: Quality = chord.quality || '';
  const seventh = chord.seventh || '';
  const tensions = Array.isArray(chord.tensions) ? chord.tensions : [];

  // m + b5 + 13 は dim7 相当として扱う
  if (quality === 'm' && chord.fifth === 'b5' && tensions.includes('13')) {
    return [0, 3, 6, 9];
  }
  if (chord.isDimMode) quality = 'dim';

  let intervals = [...(QUALITY_INTERVALS[quality] ?? [0, 4, 7])];
  if (chord.fifth === 'b5' && intervals.length >= 3) intervals[2] = 6;

  const omits = Array.isArray(chord.omits) ? chord.omits : [];
  if (omits.includes('3rd')) intervals = intervals.filter((i) => ![2, 3, 4, 5].includes(i));
  if (omits.includes('5th')) intervals = intervals.filter((i) => ![6, 7, 8].includes(i));

  const seventhInterval = SEVENTH_INTERVAL[seventh];
  if (seventh && seventhInterval !== null && seventhInterval !== undefined) {
    intervals.push(seventhInterval);
  }

  tensions.forEach((t) => {
    const base = TENSION_INTERVAL[t];
    if (base === undefined) return;
    // 13th は 7th がないとき 6th として扱う
    intervals.push(t === '13' && !seventh ? 9 : base);
  });

  return Array.from(new Set(intervals)).sort((a, b) => a - b);
}

/** テンションの並び順（9 → 11 → 13） */
function tensionOrder(t: string): number {
  return t.includes('9') ? 9 : t.includes('11') ? 11 : 13;
}

/** テンションの表記を組み立てる */
function formatTensions(tensions: Tension[], hasSeventh: boolean): string {
  if (tensions.length === 0) return '';
  const sorted = [...tensions].sort((a, b) => tensionOrder(a) - tensionOrder(b));
  if (hasSeventh) return `(${sorted.join(',')})`;

  // 7th がないときは 13 → "6"、9 → "add9" を接頭辞にする
  let prefix = '';
  const rest: string[] = [];
  if (sorted.some((t) => t === '13')) {
    prefix = '6';
    sorted.forEach((t) => t !== '13' && rest.push(t));
  } else if (sorted.some((t) => t === '9')) {
    prefix = 'add9';
    sorted.forEach((t) => t !== '9' && rest.push(t));
  } else {
    sorted.forEach((t) => rest.push(t));
  }
  if (rest.length > 0) prefix += `(${rest.join(',')})`;
  return prefix;
}

/** ルート部分を除いたコードの装飾部分を組み立てる */
function buildSuffix(chord: Chord): string {
  const quality = chord.quality || '';
  const seventh = chord.seventh || '';
  const fifth = chord.fifth === 'b5' ? '(b5)' : chord.fifth || '';
  const tensions = Array.isArray(chord.tensions) ? chord.tensions : [];

  let suffix: string;
  if (quality === 'm' && seventh === '7' && fifth === '(b5)') {
    suffix = `m7${formatTensions(tensions, true)}(b5)`;
  } else if (chord.isDimMode) {
    suffix =
      seventh === 'dim7'
        ? `dim7${formatTensions(tensions, true)}`
        : `dim${formatTensions(tensions, false)}`;
  } else if (quality === 'sus4' && seventh === '7') {
    suffix = `7sus4${formatTensions(tensions, true)}${fifth}`;
  } else if (quality === 'sus2' && seventh === '7') {
    suffix = `7sus2${formatTensions(tensions, true)}${fifth}`;
  } else if (quality === 'dim' && seventh === '7') {
    suffix = `m7${formatTensions(tensions, true)}(b5)`;
  } else {
    suffix = quality + seventh + formatTensions(tensions, seventh !== '') + fifth;
  }

  const omits = Array.isArray(chord.omits) ? chord.omits : [];
  if (omits.includes('3rd')) suffix += '(omit3)';
  if (omits.includes('5th')) suffix += '(omit5)';
  return suffix;
}

export function getChordName(chord: Chord | null | undefined): string {
  if (!chord) return '';
  if (chord.isNC) return 'N.C.';
  let name = chord.root + buildSuffix(chord);
  if (chord.onChord && chord.onChord !== chord.root) name += `/${chord.onChord}`;
  return name;
}

const DEGREE_NAMES = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'];

export function getDegreeName(chord: Chord | null | undefined, key: string): string {
  if (!chord) return '';
  if (chord.isNC) return 'N.C.';

  const tonic = rootOffset(key);
  const degree = DEGREE_NAMES[(((rootOffset(chord.root) - tonic) % 12) + 12) % 12];

  let name = degree + buildSuffix(chord);
  if (chord.onChord) {
    const bass = DEGREE_NAMES[(((rootOffset(chord.onChord) - tonic) % 12) + 12) % 12];
    if (bass !== degree) name += `/${bass}`;
  }
  return name;
}

/** キー表記はそのまま返す（元実装が恒等関数のため踏襲） */
export function getTheoreticalKeyDisplay(key: string): string {
  return key;
}

// --- ダイアトニックコード ---

const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
const MINOR_DEGREES = [0, 2, 3, 5, 7, 8, 10];

type DiatonicEntry = { quality: Quality; seventh: Seventh; fifth?: 'b5' };

const MAJOR_TRIADS: DiatonicEntry[] = [
  { quality: '', seventh: '' },
  { quality: 'm', seventh: '' },
  { quality: 'm', seventh: '' },
  { quality: '', seventh: '' },
  { quality: '', seventh: '' },
  { quality: 'm', seventh: '' },
  { quality: 'dim', seventh: '' },
];

const MAJOR_SEVENTHS: DiatonicEntry[] = [
  { quality: '', seventh: 'M7' },
  { quality: 'm', seventh: '7' },
  { quality: 'm', seventh: '7' },
  { quality: '', seventh: 'M7' },
  { quality: '', seventh: '7' },
  { quality: 'm', seventh: '7' },
  { quality: 'm', seventh: '7', fifth: 'b5' },
];

const MINOR_TRIADS: DiatonicEntry[] = [
  { quality: 'm', seventh: '' },
  { quality: 'dim', seventh: '' },
  { quality: '', seventh: '' },
  { quality: 'm', seventh: '' },
  { quality: 'm', seventh: '' },
  { quality: '', seventh: '' },
  { quality: '', seventh: '' },
];

const MINOR_SEVENTHS: DiatonicEntry[] = [
  { quality: 'm', seventh: '7' },
  { quality: 'm', seventh: '7', fifth: 'b5' },
  { quality: '', seventh: 'M7' },
  { quality: 'm', seventh: '7' },
  { quality: 'm', seventh: '7' },
  { quality: '', seventh: 'M7' },
  { quality: '', seventh: '7' },
];

export interface DiatonicChord extends DiatonicEntry {
  root: string;
}

export function getDiatonicChords(key: string, fourNote: boolean): DiatonicChord[] {
  const normalized = key || 'C';
  const isMinor = normalized.endsWith('m');
  const tonic = rootOffset(normalized);
  const degrees = isMinor ? MINOR_DEGREES : MAJOR_DEGREES;
  const table = isMinor
    ? fourNote
      ? MINOR_SEVENTHS
      : MINOR_TRIADS
    : fourNote
      ? MAJOR_SEVENTHS
      : MAJOR_TRIADS;

  return table.map((entry, i) => ({
    ...entry,
    root: getPitchClassName((tonic + degrees[i]) % 12, normalized),
  }));
}
