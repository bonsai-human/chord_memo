import type { Chord, Measure, Project, Slot } from '../types';
import { measureLength } from './measures';
import { parseChordName } from './musicTheory';
import { createEmptyProject, generateUUID } from './storage';

/** 1小節ぶんの取り込み結果。トークンは「その拍で鳴るコード名」 */
interface ParsedMeasure {
  /** null は「直前のコードが続く」 */
  tokens: (string | null)[];
  key?: string;
  tempo?: number;
  timeSignature?: [number, number];
}

interface ParsedSong {
  name?: string;
  key?: string;
  tempo?: number;
  timeSignature?: [number, number];
  measures: ParsedMeasure[];
}

function parseTimeSignature(text: string): [number, number] | undefined {
  const match = text.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  const numerator = parseInt(match[1], 10);
  const denominator = parseInt(match[2], 10);
  if (!numerator || !denominator) return undefined;
  return [numerator, denominator];
}

/** rechord.cc 形式を読む */
export function parseRechord(text: string): ParsedSong {
  const song: ParsedSong = { measures: [] };
  let previous: string | null = null;

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('#')) {
      const header = trimmed.replace(/^#\s*/, '');
      const [rawKey, ...rest] = header.split(':');
      const value = rest.join(':').trim();
      const name = rawKey.trim().toLowerCase();
      if (name === 'title') song.name = value;
      else if (name === 'key') song.key = value;
      else if (name === 'bpm' || name === 'tempo') song.tempo = parseInt(value, 10) || undefined;
      else if (name === 'meter' || name === 'time') song.timeSignature = parseTimeSignature(value);
      return;
    }

    trimmed.split('|').forEach((bar) => {
      const cells = bar.trim().split(/\s+/).filter(Boolean);
      if (cells.length === 0) return;
      const tokens = cells.map((cell) => {
        // `=` は直前と同じ、`_` `-` はコードなし
        if (cell === '=') return previous;
        if (cell === '_' || cell === '-') return null;
        previous = cell;
        return cell;
      });
      song.measures.push({ tokens });
    });
  });

  return song;
}

/** ChordPro 形式を読む */
export function parseChordPro(text: string): ParsedSong {
  const song: ParsedSong = { measures: [] };
  // 小節の途中でディレクティブが来たら、次に作る小節へ持ち越す
  let pending: Omit<ParsedMeasure, 'tokens'> = {};

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const directive = trimmed.match(/^\{\s*([a-zA-Z_]+)\s*:\s*([^}]*)\}$/);
    if (directive) {
      const name = directive[1].toLowerCase();
      const value = directive[2].trim();
      if (name === 'title' || name === 't') song.name = value;
      else if (name === 'key') {
        song.key ??= value;
        pending.key = value;
      } else if (name === 'tempo') {
        const tempo = parseInt(value, 10) || undefined;
        song.tempo ??= tempo;
        pending.tempo = tempo;
      } else if (name === 'time' || name === 'meter') {
        const timeSignature = parseTimeSignature(value);
        song.timeSignature ??= timeSignature;
        pending.timeSignature = timeSignature;
      }
      return;
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('#')) return;

    trimmed.split('|').forEach((bar) => {
      const chunk = bar.trim();
      if (!chunk) return;
      const tokens = [...chunk.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1].trim());
      // コード記号を含まない行は歌詞とみなして読み飛ばす
      if (tokens.length === 0) return;
      song.measures.push({ tokens, ...pending });
      pending = {};
    });
  });

  return song;
}

/**
 * 取り込んだ小節列を Project に組み立てる。
 * 1小節のトークン数が拍数を割り切れるときは通常の拍グリッドに載せ、
 * 割り切れないときはトークン数ぶんに等分する。
 */
function toProject(song: ParsedSong, fallbackName: string): Project {
  const base = createEmptyProject();
  const timeSignature = song.timeSignature || base.timeSignature;
  const chords: Record<string, Chord> = {};

  const measures: Measure[] = song.measures.map((parsed, index) => {
    const ts = parsed.timeSignature || timeSignature;
    const beats = ts[0];
    const beatDuration = 4 / ts[1];
    const total = measureLength(ts);
    const count = parsed.tokens.length;

    const slots: Slot[] =
      count > 0 && beats % count === 0
        ? Array.from({ length: beats }, () => ({ chordId: null, duration: beatDuration }))
        : Array.from({ length: Math.max(1, count) }, () => ({
            chordId: null,
            duration: total / Math.max(1, count),
          }));
    const step = slots.length / Math.max(1, count);

    parsed.tokens.forEach((token, i) => {
      if (!token) return;
      const parsedChord = parseChordName(token);
      if (!parsedChord) return;
      const id = generateUUID();
      chords[id] = { ...parsedChord, id };
      const at = Math.round(i * step);
      if (slots[at]) slots[at].chordId = id;
    });

    return {
      id: generateUUID(),
      slots,
      ...(index === 0
        ? {
            key: song.key || base.key,
            tempo: song.tempo || base.tempo,
            timeSignature: ts,
          }
        : {
            key: parsed.key,
            tempo: parsed.tempo,
            timeSignature: parsed.timeSignature,
          }),
    };
  });

  return {
    ...base,
    name: song.name || fallbackName,
    key: song.key || base.key,
    tempo: song.tempo || base.tempo,
    timeSignature,
    measures: measures.length > 0 ? measures : base.measures,
    chords,
  };
}

export type ImportFormat = 'json' | 'rechord' | 'chordpro';

/** 中身を見て形式を判定する */
export function detectFormat(text: string): ImportFormat {
  const head = text.trimStart();
  if (head.startsWith('{') && /"measures"\s*:/.test(text)) return 'json';
  if (/^\{\s*(title|t|key|tempo|time|meter)\s*:/im.test(text) || /\[[^\]]+\]/.test(text)) {
    return 'chordpro';
  }
  return 'rechord';
}

/** テキストを Project に変換する。JSON はそのまま読む */
export function parseImport(text: string, fallbackName: string): Project {
  const format = detectFormat(text);
  if (format === 'json') return JSON.parse(text) as Project;
  const song = format === 'chordpro' ? parseChordPro(text) : parseRechord(text);
  return toProject(song, fallbackName);
}
