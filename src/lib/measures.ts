import type { Chord, EffectiveSettings, Measure, MelodyNote, Project } from '../types';
import {
  getPitchClassName,
  getTranspositionOffset,
  rootOffset,
  transposeKey,
} from './musicTheory';
import { cleanupOrphanedChords, createEmptyMeasure, generateUUID } from './storage';

/** 内容を持つ最後の小節の後ろに常に確保する空小節の数 */
const TRAILING_EMPTY_MEASURES = 3;

/**
 * メロディーを動かす向き。コードはピッチクラスしか持たないので +11 でも
 * −1 でも同じだが、メロディーはオクターブを持つため近い方へ動かす
 */
const nearestShift = (semitones: number) => (semitones > 6 ? semitones - 12 : semitones);

function hasContent(m: Measure): boolean {
  return (
    m.slots.some((s) => s.chordId !== null) ||
    (m.melody?.length ?? 0) > 0 ||
    !!m.label ||
    !!m.referenceLabel
  );
}

export function lastContentIndex(measures: Measure[]): number {
  let last = -1;
  measures.forEach((m, i) => {
    if (hasContent(m)) last = i;
  });
  return last;
}

/** 1小節の総 duration（4分音符 = 1） */
export function measureLength(timeSignature: [number, number]): number {
  return timeSignature[0] * (4 / timeSignature[1]);
}

/**
 * 小節 index の実効設定を求める。
 * 先頭から走査して最後に明示指定された値を採り、その値を index 自身が
 * 指定したかどうかを isOverride で返す。
 */
export function resolveMeasureSettings(
  index: number,
  project: Project | null,
  measures?: Measure[],
): EffectiveSettings {
  const list = measures || project?.measures || [];
  const settings: EffectiveSettings = {
    key: project?.key || 'C',
    tempo: project?.tempo || 120,
    timeSignature: project?.timeSignature || [4, 4],
    isOverride: { key: false, tempo: false, timeSignature: false },
  };

  for (let i = 0; i <= index; i++) {
    const m = list[i];
    if (!m) continue;
    if (m.key) {
      settings.key = m.key;
      settings.isOverride.key = i === index;
    }
    if (m.tempo) {
      settings.tempo = m.tempo;
      settings.isOverride.tempo = i === index;
    }
    if (m.timeSignature) {
      settings.timeSignature = m.timeSignature;
      settings.isOverride.timeSignature = i === index;
    }
  }
  return settings;
}

/**
 * 末尾の空小節を過不足なく整え、宙に浮いた参照をクリアする。
 * 変更のたびに通す。
 */
export function normalizeProject(project: Project): Project {
  const measures = [...project.measures];
  const target = lastContentIndex(measures) + 1 + TRAILING_EMPTY_MEASURES;

  if (measures.length > target) {
    measures.splice(target);
  } else {
    for (let i = measures.length; i < target; i++) {
      const ts = resolveMeasureSettings(i, project, measures).timeSignature;
      measures.push(createEmptyMeasure(ts[0], undefined, undefined, undefined, 4 / ts[1]));
    }
  }

  const labels = new Set(measures.map((m) => m.label).filter(Boolean));
  measures.forEach((m) => {
    if (m.referenceLabel && !labels.has(m.referenceLabel)) m.referenceLabel = undefined;
    if (!m.referenceLabel) m.isReferenceExpanded = false;
  });

  // 拍子が変わると小節の長さが変わるので、はみ出した音をここで整える
  return cleanupOrphanedChords({
    ...project,
    measures: sanitizeMelody(project, measures),
  });
}

/**
 * 小節設定を更新する。以下が連鎖する。
 *  - 直前の実効値と同じ指定は冗長なので落とす
 *  - 拍子変更はスロット数と duration を作り直し、後続小節にも伝播する
 *  - キー変更はそこから次のキー指定小節の手前までのコードを移調する
 */
export function updateMeasureSettings(
  project: Project,
  measureId: string,
  patch: Partial<Measure>,
): Project {
  const index = project.measures.findIndex((m) => m.id === measureId);
  if (index === -1) return project;

  const changes: Partial<Measure> = { ...patch };
  const measures = [...project.measures];
  const before = resolveMeasureSettings(index, project, measures);

  // 直前と同じ値なら指定を持たせない
  if (index > 0) {
    const prev = resolveMeasureSettings(index - 1, project, measures);
    if (changes.key !== undefined && changes.key === prev.key) changes.key = undefined;
    if (changes.tempo !== undefined && changes.tempo === prev.tempo) changes.tempo = undefined;
    if (
      changes.timeSignature !== undefined &&
      changes.timeSignature[0] === prev.timeSignature[0] &&
      changes.timeSignature[1] === prev.timeSignature[1]
    ) {
      changes.timeSignature = undefined;
    }
  }

  const target = measures[index];
  const probe = [...measures];
  probe[index] = { ...target, ...changes };
  const after = resolveMeasureSettings(index, project, probe);

  // 拍子が変わったらスロットを組み直す
  let slots = target.slots;
  const ts = after.timeSignature;
  if (ts[0] !== before.timeSignature[0] || ts[1] !== before.timeSignature[1]) {
    if (ts[0] !== slots.length) {
      slots =
        ts[0] > slots.length
          ? [
              ...slots,
              ...Array.from({ length: ts[0] - slots.length }, () => ({
                chordId: null,
                duration: 4 / ts[1],
              })),
            ]
          : slots.slice(0, ts[0]);
    }
    slots = slots.map((s) => ({ ...s, duration: 4 / ts[1] }));
  }

  measures[index] = { ...target, ...changes, slots };
  const chords = { ...project.chords };

  // キー変更は次のキー指定小節の手前までを移調する
  if (Object.prototype.hasOwnProperty.call(changes, 'key') && before.key !== after.key) {
    const semitones =
      (getTranspositionOffset(after.key) - getTranspositionOffset(before.key) + 12) % 12;
    if (semitones !== 0) {
      const remapped: Record<string, string> = {};
      for (let i = index; i < measures.length; i++) {
        if (i > index && measures[i].key) break;
        const m = measures[i];
        const nextSlots = m.slots.map((slot) => {
          if (!slot.chordId) return slot;
          if (remapped[slot.chordId]) return { ...slot, chordId: remapped[slot.chordId] };
          const chord = project.chords[slot.chordId];
          if (!chord) return slot;
          const transposed = {
            ...chord,
            id: generateUUID(),
            root: getPitchClassName((rootOffset(chord.root) + semitones) % 12, after.key),
            onChord: chord.onChord
              ? getPitchClassName((rootOffset(chord.onChord) + semitones) % 12, after.key)
              : chord.onChord,
          };
          chords[transposed.id] = transposed;
          remapped[slot.chordId] = transposed.id;
          return { ...slot, chordId: transposed.id };
        });
        // メロディーも同じだけ動かす（音域を保つため近い向きで）
        const melodyShift = nearestShift(semitones);
        const nextMelody = m.melody?.map((note) => ({ ...note, pitch: note.pitch + melodyShift }));
        measures[i] = { ...m, slots: nextSlots, melody: nextMelody };
      }
    }
  }

  // 拍子変更は明示指定のある小節に当たるまで後続へ伝播する
  if (ts[0] !== before.timeSignature[0] || ts[1] !== before.timeSignature[1]) {
    for (let i = index + 1; i < measures.length; i++) {
      const m = measures[i];
      if (m.timeSignature) break;
      const duration = 4 / ts[1];
      if (ts[0] === m.slots.length && m.slots[0]?.duration === duration) continue;
      const nextSlots =
        ts[0] > m.slots.length
          ? [
              ...m.slots,
              ...Array.from({ length: ts[0] - m.slots.length }, () => ({
                chordId: null,
                duration,
              })),
            ]
          : m.slots.slice(0, ts[0]);
      measures[i] = { ...m, slots: nextSlots.map((s) => ({ ...s, duration })) };
    }
  }

  return normalizeProject({ ...project, measures, chords });
}

/**
 * 曲全体を移調する。キー指定と、そこにぶら下がるコードをまとめて動かす。
 * 音名の綴りは移調後のキーに従う。
 */
export function transposeProject(project: Project, semitones: number): Project {
  const shift = (((semitones % 12) + 12) % 12);
  if (shift === 0) return project;

  // 先にキー指定を移調しておく。コードの綴りは移調後のキーで決まる
  const keyed = project.measures.map((measure) => ({
    ...measure,
    key: measure.key ? transposeKey(measure.key, shift) : measure.key,
  }));
  const shifted: Project = {
    ...project,
    key: transposeKey(project.key, shift),
    measures: keyed,
  };

  const chords: Record<string, Chord> = {};
  /** 同じコードでも小節のキーが違えば綴りが変わるので、キーごとに作る */
  const remapped: Record<string, string> = {};

  const measures = keyed.map((measure, index) => {
    const key = resolveMeasureSettings(index, shifted, keyed).key;
    const slots = measure.slots.map((slot) => {
      if (!slot.chordId) return slot;
      const cacheKey = `${slot.chordId}_${key}`;
      if (!remapped[cacheKey]) {
        const chord = project.chords[slot.chordId];
        if (!chord) return slot;
        const id = generateUUID();
        chords[id] = {
          ...chord,
          id,
          root: getPitchClassName(rootOffset(chord.root) + shift, key),
          onChord: chord.onChord
            ? getPitchClassName(rootOffset(chord.onChord) + shift, key)
            : chord.onChord,
        };
        remapped[cacheKey] = id;
      }
      return { ...slot, chordId: remapped[cacheKey] };
    });
    const melody = measure.melody?.map((note) => ({
      ...note,
      pitch: note.pitch + nearestShift(shift),
    }));
    return { ...measure, slots, melody };
  });

  return normalizeProject({ ...shifted, measures, chords });
}

const MELODY_EPSILON = 0.0001;

/** その小節のメロディー。start 昇順で返る */
export function melodyOf(measure: Measure): MelodyNote[] {
  return measure.melody ?? [];
}

/** 曲中で使われている音高の範囲。メロディーの縦位置を決めるのに使う */
export function melodyRange(project: Project): { low: number; high: number } | null {
  let low = Infinity;
  let high = -Infinity;
  project.measures.forEach((measure) => {
    measure.melody?.forEach((note) => {
      if (note.pitch < low) low = note.pitch;
      if (note.pitch > high) high = note.pitch;
    });
  });
  return low === Infinity ? null : { low, high };
}

/** 小節の曲頭からの位置と長さ（4分音符 = 1） */
export interface MeasureSpan {
  start: number;
  length: number;
}

export function measureSpans(project: Project, measures?: Measure[]): MeasureSpan[] {
  const list = measures ?? project.measures;
  const spans: MeasureSpan[] = [];
  let position = 0;
  list.forEach((_, index) => {
    const length = measureLength(resolveMeasureSettings(index, project, list).timeSignature);
    spans.push({ start: position, length });
    position += length;
  });
  return spans;
}

/** 曲頭からの絶対位置に並べたメロディー */
interface AbsoluteNote {
  abs: number;
  duration: number;
  pitch: number;
}

function flattenMelody(measures: Measure[], spans: MeasureSpan[]): AbsoluteNote[] {
  const notes: AbsoluteNote[] = [];
  measures.forEach((measure, index) => {
    const span = spans[index];
    if (!span) return;
    measure.melody?.forEach((note) => {
      notes.push({ abs: span.start + note.start, duration: note.duration, pitch: note.pitch });
    });
  });
  return notes.sort((a, b) => a.abs - b.abs);
}

/**
 * 絶対位置の音列を小節へ配り直す。音は「始まりのある小節」が持ち、
 * 小節をまたぐぶんは duration に残る。重なりは後ろの音を優先して詰める。
 */
function unflattenMelody(
  measures: Measure[],
  spans: MeasureSpan[],
  notes: AbsoluteNote[],
): Measure[] {
  const buckets: MelodyNote[][] = measures.map(() => []);
  const sorted = [...notes].sort((a, b) => a.abs - b.abs);
  const total = spans.length ? spans[spans.length - 1].start + spans[spans.length - 1].length : 0;

  sorted.forEach((note, i) => {
    // 次の音に食い込まないよう、また曲の終わりを超えないように詰める
    const limit = Math.min(sorted[i + 1]?.abs ?? total, total);
    const duration = Math.min(note.duration, limit - note.abs);
    if (duration <= MELODY_EPSILON) return;

    let index = spans.findIndex(
      (span) => note.abs < span.start + span.length - MELODY_EPSILON,
    );
    if (index === -1) index = spans.length - 1;
    if (index < 0) return;
    buckets[index].push({
      start: Math.max(0, note.abs - spans[index].start),
      duration,
      pitch: note.pitch,
    });
  });

  return measures.map((measure, index) => {
    const melody = buckets[index];
    if (melody.length === 0) {
      return measure.melody === undefined ? measure : { ...measure, melody: undefined };
    }
    return { ...measure, melody };
  });
}

/**
 * メロディーを整える。拍子が変わると小節の長さが変わるので、
 * 入りきらなくなった音を落とし、重なりを詰める。
 *
 * コードのスロットが小節に留まるのに合わせて、音も小節に留める
 * （絶対時間で置き直すと小節線に対してずれてしまう）。
 */
function sanitizeMelody(project: Project, measures: Measure[]): Measure[] {
  if (!measures.some((m) => m.melody && m.melody.length > 0)) return measures;
  const spans = measureSpans(project, measures);

  const cleaned = measures.map((measure, index) => {
    if (!measure.melody || measure.melody.length === 0) {
      return measure.melody === undefined ? measure : { ...measure, melody: undefined };
    }
    const length = spans[index]?.length ?? 0;
    const notes = measure.melody
      .filter(
        (note) =>
          note.start > -MELODY_EPSILON &&
          note.start < length - MELODY_EPSILON &&
          note.duration > MELODY_EPSILON,
      )
      .map((note) => ({ ...note, start: Math.max(0, note.start) }))
      .sort((a, b) => a.start - b.start);

    // 同じ小節の中の重なりは後ろの音を優先して詰める
    for (let i = 0; i < notes.length - 1; i++) {
      notes[i].duration = Math.min(notes[i].duration, notes[i + 1].start - notes[i].start);
    }
    if (notes.length === 0) {
      return measure.melody === undefined ? measure : { ...measure, melody: undefined };
    }
    return { ...measure, melody: notes };
  });

  // 小節をまたぐ音が次の音や曲の終わりに食い込まないように切る
  const total = spans.length ? spans[spans.length - 1].start + spans[spans.length - 1].length : 0;
  cleaned.forEach((measure, index) => {
    const notes = measure.melody;
    if (!notes || notes.length === 0) return;
    const last = notes[notes.length - 1];
    const abs = spans[index].start + last.start;
    let limit = total;
    for (let i = index + 1; i < cleaned.length; i++) {
      const next = cleaned[i].melody?.[0];
      if (next) {
        limit = spans[i].start + next.start;
        break;
      }
    }
    last.duration = Math.min(last.duration, limit - abs);
  });

  return cleaned;
}

export interface MelodyInput {
  pitch: number;
  /** 音価（4分音符 = 1）。付点や3連もここに畳んで渡す */
  duration: number;
}

/**
 * メロディーに音を書き込む。重なった音は消し、途中まで鳴っていた音は
 * 新しい音の手前で切る。小節をまたぐ長さでもそのまま入る。
 */
export function writeMelodyNote(
  project: Project,
  measureId: string,
  start: number,
  note: MelodyInput,
): Project {
  const measureIndex = project.measures.findIndex((m) => m.id === measureId);
  if (measureIndex === -1) return project;

  const measures = [...project.measures];
  const spans = measureSpans(project, measures);
  const abs = spans[measureIndex].start + start;
  const total = spans[spans.length - 1].start + spans[spans.length - 1].length;
  const duration = Math.min(note.duration, total - abs);
  if (duration <= MELODY_EPSILON) return project;

  const kept: AbsoluteNote[] = [];
  flattenMelody(measures, spans).forEach((existing) => {
    const end = existing.abs + existing.duration;
    // 新しい音の中で始まる音は丸ごと消す
    if (existing.abs >= abs - MELODY_EPSILON && existing.abs < abs + duration - MELODY_EPSILON) {
      return;
    }
    // 手前から食い込んでいる音は新しい音の直前で切る
    if (existing.abs < abs && end > abs + MELODY_EPSILON) {
      kept.push({ ...existing, duration: abs - existing.abs });
      return;
    }
    kept.push(existing);
  });
  kept.push({ abs, duration, pitch: note.pitch });

  return normalizeProject({
    ...project,
    measures: unflattenMelody(measures, spans, kept),
  });
}

/** 絶対位置 [from, to) にかかる音を消す */
export function removeMelodyNotes(project: Project, from: number, to: number): Project {
  const measures = [...project.measures];
  const spans = measureSpans(project, measures);
  const kept = flattenMelody(measures, spans).filter((note) => {
    const end = note.abs + note.duration;
    return end <= from + MELODY_EPSILON || note.abs >= to - MELODY_EPSILON;
  });
  return normalizeProject({
    ...project,
    measures: unflattenMelody(measures, spans, kept),
  });
}

/** 位置 start に鳴っている音。カーソル上の音を掴むのに使う */
export function melodyNoteAt(
  measure: Measure,
  start: number,
): { note: MelodyNote; index: number } | null {
  const melody = melodyOf(measure);
  for (let i = 0; i < melody.length; i++) {
    const note = melody[i];
    if (
      start >= note.start - MELODY_EPSILON &&
      start < note.start + note.duration - MELODY_EPSILON
    ) {
      return { note, index: i };
    }
  }
  return null;
}

/** 1つの小節に描くメロディーの一片。小節をまたぐ音は複数の片に分かれる */
export interface MelodySegment {
  /** この小節の中で描く範囲（小節頭からの拍） */
  from: number;
  to: number;
  pitch: number;
  /** 音の始まり・終わりがこの小節にあるか。角の丸めに使う */
  isStart: boolean;
  isEnd: boolean;
  /** 音を持っている小節と、その中での index */
  ownerIndex: number;
  noteIndex: number;
}

/** 小節ごとに、そこに描くべきメロディーの片を求める */
export function melodySegments(project: Project, spans: MeasureSpan[]): MelodySegment[][] {
  const result: MelodySegment[][] = project.measures.map(() => []);

  project.measures.forEach((measure, ownerIndex) => {
    const span = spans[ownerIndex];
    if (!span) return;
    measure.melody?.forEach((note, noteIndex) => {
      const abs = span.start + note.start;
      const absEnd = abs + note.duration;
      for (let i = ownerIndex; i < spans.length; i++) {
        const target = spans[i];
        if (target.start >= absEnd - MELODY_EPSILON) break;
        const from = Math.max(0, abs - target.start);
        const to = Math.min(target.length, absEnd - target.start);
        if (to - from <= MELODY_EPSILON) continue;
        result[i].push({
          from,
          to,
          pitch: note.pitch,
          isStart: i === ownerIndex,
          isEnd: absEnd <= target.start + target.length + MELODY_EPSILON,
          ownerIndex,
          noteIndex,
        });
      }
    });
  });

  return result;
}

/** メロディー面のマス1つぶんの長さ。拍子どおりの等分で、コードの刻みとは無関係 */
export function beatLength(timeSignature: [number, number]): number {
  return 4 / timeSignature[1];
}

export type RhythmDivision = 'div4' | 'div8' | 'div16' | 'div4t' | 'div8t';

const DIVISION_DURATION: Record<RhythmDivision, number> = {
  div4: 1,
  div8: 0.5,
  div16: 0.25,
  div4t: 2 / 3,
  div8t: 1 / 3,
};

/** 小節のリズムを細分化する。元の位置にあったコードは引き継ぐ */
export function splitRhythm(
  project: Project,
  measureId: string,
  division: RhythmDivision,
): Project {
  const index = project.measures.findIndex((m) => m.id === measureId);
  if (index === -1) return project;

  const measures = [...project.measures];
  const target = measures[index];
  const total = measureLength(resolveMeasureSettings(index, project, measures).timeSignature);
  const unit = DIVISION_DURATION[division];
  const count = Math.round(total / unit);
  const epsilon = 0.001;

  const slots = [];
  let position = 0;
  for (let i = 0; i < count; i++) {
    const duration = i === count - 1 ? Math.max(0.1, total - position) : unit;

    // 新しいスロットの開始時刻に重なっていた元スロットのコードを拾う
    let chordId: string | null = null;
    let cursor = 0;
    for (const slot of target.slots) {
      if (cursor + slot.duration > position + epsilon && cursor <= position + epsilon) {
        chordId = slot.chordId;
        break;
      }
      cursor += slot.duration;
    }

    slots.push({ chordId, duration });
    position += duration;
  }

  measures[index] = { ...target, slots };
  return normalizeProject({ ...project, measures });
}

/** 参照小節を実際の並びに展開する（再生・書き出し用） */
export interface ExpandedMeasure {
  measure: Measure;
  originalIndex: number;
  loopCurrent?: number;
  loopTotal?: number;
  expansionIndex?: number;
}

export function getExpandedMeasures(project: Project): ExpandedMeasure[] {
  const last = lastContentIndex(project.measures);
  const target = last === -1 ? [project.measures[0]] : project.measures.slice(0, last + 1);
  const result: ExpandedMeasure[] = [];

  target.forEach((measure, index) => {
    if (measure.referenceLabel) {
      const label = measure.referenceLabel.trim();
      const source = project.measures.filter((m) => m.label && m.label.trim() === label);
      const loops = measure.referenceLoopCount || 1;
      if (source.length > 0) {
        for (let loop = 0; loop < loops; loop++) {
          source.forEach((src, i) => {
            const copy = { ...src };
            // 展開1周目の先頭にだけ参照元の設定を被せる
            if (loop === 0 && i === 0) {
              if (measure.key) copy.key = measure.key;
              if (measure.tempo) copy.tempo = measure.tempo;
              if (measure.timeSignature) copy.timeSignature = measure.timeSignature;
              if (measure.swing !== undefined) copy.swing = measure.swing;
            }
            result.push({
              measure: copy,
              originalIndex: project.measures.indexOf(src),
              loopCurrent: loop + 1,
              loopTotal: loops,
              expansionIndex: i,
            });
          });
        }
        return;
      }
    }
    result.push({ measure, originalIndex: index });
  });

  return result;
}

/** 実効設定が変わらない小節の連なり（グリッドの1ブロック） */
export interface Chunk {
  startIndex: number;
  measures: Measure[];
  settings: EffectiveSettings;
}

export function buildChunks(
  measures: Measure[],
  resolve: (index: number) => EffectiveSettings,
): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;

  measures.forEach((measure, index) => {
    const settings = resolve(index);
    let boundary = index === 0;
    if (!boundary && current) {
      const prev = current.settings;
      boundary =
        settings.key !== prev.key ||
        settings.tempo !== prev.tempo ||
        settings.timeSignature[0] !== prev.timeSignature[0] ||
        settings.timeSignature[1] !== prev.timeSignature[1];
    }
    if (boundary) {
      if (current) chunks.push(current);
      current = { startIndex: index, measures: [], settings };
    }
    current?.measures.push(measure);
  });

  if (current) chunks.push(current);
  return chunks;
}
