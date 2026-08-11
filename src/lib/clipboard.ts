import type { Chord, EffectiveSettings, MelodyNote, Project, Slot, SlotRef } from '../types';
import {
  beatLength,
  measureLength,
  measureSpans,
  normalizeProject,
  pasteMelodyNotes,
  resolveMeasureSettings,
} from './measures';
import {
  getPitchClassName,
  getTranspositionOffset,
  rootOffset,
  transposeKey,
} from './musicTheory';
import { cloneChord, createEmptyMeasure, generateUUID } from './storage';

const EPSILON = 0.0001;

export interface CopiedMeasure {
  slots: Slot[];
  /** その小節が明示的に持っていた設定（継承値は含まない） */
  metadata: {
    key?: string;
    tempo?: number;
    timeSignature?: [number, number];
  };
  /** コピー元での実効キー。移調貼り付けの基準になる */
  effectiveKey: string;
}

export interface ChordCopyBuffer {
  kind: 'chord';
  measures: CopiedMeasure[];
  chords: Record<string, Chord>;
}

/** メロディーは音そのものを持つ。位置は範囲の先頭からの相対値 */
export interface MelodyCopyBuffer {
  kind: 'melody';
  notes: MelodyNote[];
  /** 範囲の長さ（拍）。貼り付け先で上書きする幅になる */
  span: number;
  /** コピー元の実効キー。移調貼り付けの基準になる */
  effectiveKey: string;
}

export type CopyBuffer = ChordCopyBuffer | MelodyCopyBuffer;

export type PasteMode = 'normal' | 'transposed';

export interface CopyResult {
  buffer?: CopyBuffer;
  message: string;
}

/** 始点と終点から求めた、前後の向きを揃えた選択範囲 */
export interface SlotRange {
  /** 小節インデックス */
  from: number;
  to: number;
  /** from の小節での開始スロット */
  firstSlot: number;
  /** to の小節での終了スロット */
  lastSlot: number;
}

/**
 * 選択の始点・終点を前後の向きに揃える。
 * 終点が無ければ始点1マスだけの範囲になる。
 */
export function resolveRange(
  project: Project,
  start: SlotRef,
  end: SlotRef | null,
): SlotRange | null {
  const tail = end || start;
  const startIndex = project.measures.findIndex((m) => m.id === start.measureId);
  const endIndex = project.measures.findIndex((m) => m.id === tail.measureId);
  if (startIndex === -1 || endIndex === -1) return null;

  const forward =
    startIndex < endIndex || (startIndex === endIndex && start.slotIndex <= tail.slotIndex);
  return forward
    ? { from: startIndex, to: endIndex, firstSlot: start.slotIndex, lastSlot: tail.slotIndex }
    : { from: endIndex, to: startIndex, firstSlot: tail.slotIndex, lastSlot: start.slotIndex };
}

/** 選択範囲をコピーバッファへ取り出す */
export function copyRange(
  project: Project,
  start: SlotRef,
  end: SlotRef | null,
  resolve: (index: number) => EffectiveSettings,
): CopyResult {
  const range = resolveRange(project, start, end);
  if (!range) return { message: 'コピーできませんでした' };
  const { from, to, firstSlot, lastSlot } = range;

  if (project.measures.slice(from, to + 1).some((m) => m.referenceLabel)) {
    return {
      message: '参照関係を含む範囲はコピーできません。コードのみを選択してください。',
    };
  }

  const measures: CopiedMeasure[] = [];
  const chords: Record<string, Chord> = {};

  for (let i = from; i <= to; i++) {
    const measure = project.measures[i];
    const begin = i === from ? firstSlot : 0;
    const finish = i === to ? lastSlot : measure.slots.length - 1;

    const slots: Slot[] = [];
    for (let s = begin; s <= finish; s++) {
      const slot = measure.slots[s];
      slots.push({ chordId: slot.chordId, duration: slot.duration });
      if (slot.chordId && project.chords[slot.chordId]) {
        chords[slot.chordId] = project.chords[slot.chordId];
      }
    }

    measures.push({
      slots,
      metadata: {
        key: measure.key,
        tempo: measure.tempo,
        timeSignature: measure.timeSignature,
      },
      effectiveKey: resolve(i).key,
    });
  }

  return {
    buffer: { kind: 'chord', measures, chords },
    message: end ? `${measures.length} 小節分(一部含む)をコピーしました。` : 'コードをコピーしました',
  };
}

/** 半音差ぶんコードを移調する */
function transposeChord(chord: Chord, semitones: number, targetKey: string): Chord {
  if (!semitones) return chord;
  const shift = (name: string) => {
    const isMinor = name.endsWith('m');
    const pitch = (rootOffset(name) + semitones) % 12;
    return getPitchClassName(pitch, targetKey) + (isMinor ? 'm' : '');
  };
  return {
    ...chord,
    root: shift(chord.root),
    onChord: chord.onChord ? shift(chord.onChord) : chord.onChord,
  };
}

/**
 * コピーバッファを貼り付ける。
 * 1小節目は挿入位置に差し込み（前後の既存スロットは分割される）、
 * 2小節目以降は小節をまるごと置き換える。
 */
export function pasteBuffer(
  project: Project,
  buffer: ChordCopyBuffer,
  target: SlotRef,
  mode: PasteMode,
): Project {
  const targetIndex = project.measures.findIndex((m) => m.id === target.measureId);
  if (targetIndex === -1) return project;

  const measures = [...project.measures];
  const chords: Record<string, Chord> = { ...project.chords, ...buffer.chords };
  /** コピー元 chordId → 貼り付け後 chordId */
  const idMap: Record<string, string> = {};
  let cursor = targetIndex;

  // 移調量は範囲の先頭だけで決め、全小節に同じ量を使う。
  // 小節ごとに測り直すと、範囲の途中の転調が貼り付け先のキーへ潰れてしまう
  const semitones =
    mode === 'transposed'
      ? (getTranspositionOffset(resolveMeasureSettings(targetIndex, project, measures).key) -
          getTranspositionOffset(buffer.measures[0]?.effectiveKey || 'C') +
          12) %
        12
      : 0;

  buffer.measures.forEach((copied, order) => {
    // 書き込み先が足りなければ末尾に空小節を足す
    while (cursor >= measures.length) {
      const last = measures[measures.length - 1];
      measures.push(
        createEmptyMeasure(
          last.slots.length,
          undefined,
          undefined,
          undefined,
          4 / (last.timeSignature ? last.timeSignature[1] : 4),
        ),
      );
    }

    const settings = resolveMeasureSettings(cursor, project, measures);

    // この小節に持ち込むキー指定。移調貼り付けでは移調した名前になる
    const pastedKey =
      copied.metadata.key && mode === 'transposed'
        ? transposeKey(copied.metadata.key, semitones)
        : copied.metadata.key;
    // 音名の綴りは、その位置で実際に効くキーに従う
    const spellingKey = pastedKey ?? settings.key;

    const mapChordId = (id: string | null): string | null => {
      if (!id) return null;
      const cacheKey = mode === 'transposed' ? `${id}_T${semitones}_${spellingKey}` : id;
      if (!idMap[cacheKey]) {
        const newId = generateUUID();
        const source = buffer.chords[id];
        if (source) {
          const chord = mode === 'transposed' ? transposeChord(source, semitones, spellingKey) : source;
          chords[newId] = { ...chord, id: newId };
        }
        idMap[cacheKey] = newId;
      }
      return idMap[cacheKey];
    };

    const destination = measures[cursor];

    if (order === 0) {
      // 挿入位置までの長さ
      let insertAt = 0;
      for (let i = 0; i < target.slotIndex; i++) insertAt += destination.slots[i].duration;

      const slots: Slot[] = [];
      let filled = 0;

      // 挿入位置より前を残す。途中で切れる場合は分割する
      if (target.slotIndex > 0) {
        for (const slot of destination.slots) {
          if (filled + slot.duration <= insertAt + EPSILON) {
            slots.push(slot);
            filled += slot.duration;
          } else if (filled < insertAt) {
            const partial = insertAt - filled;
            slots.push({
              ...slot,
              duration: partial,
              chordId: slot.chordId ? cloneChord(project.chords[slot.chordId], chords) : null,
            });
            filled += partial;
          } else {
            break;
          }
        }
      }

      // コピー内容を差し込む
      for (const slot of copied.slots) {
        slots.push({ chordId: mapChordId(slot.chordId), duration: slot.duration });
        filled += slot.duration;
      }

      // 差し込みで押し出された残りを後ろに戻す
      let scanned = 0;
      for (const slot of destination.slots) {
        if (scanned + slot.duration > filled + EPSILON) {
          const consumed = Math.max(0, filled - scanned);
          const rest = slot.duration - consumed;
          if (rest > EPSILON) {
            slots.push({
              ...slot,
              duration: rest,
              chordId: slot.chordId ? cloneChord(project.chords[slot.chordId], chords) : null,
            });
            filled += rest;
          }
        }
        scanned += slot.duration;
      }

      const barLength = measureLength(destination.timeSignature || [4, 4]);
      if (filled < barLength - EPSILON) {
        slots.push({ chordId: null, duration: barLength - filled });
      }

      measures[cursor] = { ...destination, slots };
    } else {
      measures[cursor] = {
        ...destination,
        slots: copied.slots.map((slot) => ({
          chordId: mapChordId(slot.chordId),
          duration: slot.duration,
        })),
      };
    }

    // 元の小節設定を貼り付け先へ持ち込む。
    // 移調貼り付けでも、範囲の途中の転調・テンポ変更・拍子変更は保つ
    // （キーは移調後の名前になる。先頭のキーは貼り付け先と一致するので落ちる）
    {
      const current = resolveMeasureSettings(cursor, project, measures);
      const { tempo, timeSignature } = copied.metadata;
      // 移調貼り付けの先頭は貼り付け先のキーに合わせるのが目的なので、
      // コピー元のキーで上書きしない（平行調どうしでも名前は違うため）
      const keepDestinationKey = mode === 'transposed' && order === 0;
      if (pastedKey && !keepDestinationKey && pastedKey !== current.key) {
        measures[cursor].key = pastedKey;
      }
      if (tempo && tempo !== current.tempo) measures[cursor].tempo = tempo;
      if (
        timeSignature &&
        (timeSignature[0] !== current.timeSignature[0] ||
          timeSignature[1] !== current.timeSignature[1])
      ) {
        measures[cursor].timeSignature = timeSignature;
      }
    }

    cursor++;
  });

  return normalizeProject({ ...project, measures, chords });
}

/** 選択範囲を絶対位置（拍）に直す。メロディーは小節の刻みと無関係なので拍で扱う */
function rangeBeats(
  project: Project,
  range: SlotRange,
): { from: number; to: number } {
  const spans = measureSpans(project);
  const cell = (index: number) =>
    beatLength(resolveMeasureSettings(index, project).timeSignature);
  return {
    from: spans[range.from].start + range.firstSlot * cell(range.from),
    to: spans[range.to].start + (range.lastSlot + 1) * cell(range.to),
  };
}

/**
 * メロディーをコピーする。範囲の中で**始まる**音を、範囲の先頭からの
 * 相対位置で持つ。範囲をはみ出す音は範囲の終わりで切る。
 */
export function copyMelodyRange(
  project: Project,
  start: SlotRef,
  end: SlotRef | null,
  resolve: (index: number) => EffectiveSettings,
): CopyResult {
  const range = resolveRange(project, start, end);
  if (!range) return { message: 'コピーできませんでした' };

  if (project.measures.slice(range.from, range.to + 1).some((m) => m.referenceLabel)) {
    return { message: '参照小節を含む範囲はコピーできません' };
  }

  const { from, to } = rangeBeats(project, range);
  const spans = measureSpans(project);
  const notes: MelodyNote[] = [];

  project.measures.forEach((measure, index) => {
    measure.melody?.forEach((note) => {
      const abs = spans[index].start + note.start;
      if (abs < from - EPSILON || abs >= to - EPSILON) return;
      notes.push({
        start: abs - from,
        duration: Math.min(note.duration, to - abs),
        pitch: note.pitch,
      });
    });
  });

  if (notes.length === 0) return { message: 'コピーする音がありません' };

  return {
    buffer: {
      kind: 'melody',
      notes: notes.sort((a, b) => a.start - b.start),
      span: to - from,
      effectiveKey: resolve(range.from).key,
    },
    message: `${notes.length} 個の音をコピーしました`,
  };
}

/**
 * メロディーを貼り付ける。カーソル位置から範囲の長さぶんを置き換える。
 * 移調貼り付けでは、音域が飛ばないよう近い向きへ動かす。
 */
export function pasteMelodyBuffer(
  project: Project,
  buffer: MelodyCopyBuffer,
  target: SlotRef,
  targetStart: number,
  mode: PasteMode,
): { project: Project; message: string } {
  const targetIndex = project.measures.findIndex((m) => m.id === target.measureId);
  if (targetIndex === -1) return { project, message: '貼り付けできませんでした' };

  const spans = measureSpans(project);
  const absStart = spans[targetIndex].start + targetStart;
  const absEnd = absStart + buffer.span;

  // 参照小節はメロディーを持てないので、そこへは貼れない
  const blocked = project.measures.some((m, i) => {
    if (!m.referenceLabel) return false;
    return spans[i].start < absEnd - EPSILON && spans[i].start + spans[i].length > absStart + EPSILON;
  });
  if (blocked) return { project, message: '参照小節にはメロディーを貼り付けられません' };

  let semitones = 0;
  if (mode === 'transposed') {
    const raw =
      (getTranspositionOffset(resolveMeasureSettings(targetIndex, project).key) -
        getTranspositionOffset(buffer.effectiveKey) +
        12) %
      12;
    // 7半音上げるより5半音下げるほうが元の音域に近い
    semitones = raw > 6 ? raw - 12 : raw;
  }

  const notes = buffer.notes.map((note) => ({ ...note, pitch: note.pitch + semitones }));
  return {
    project: pasteMelodyNotes(project, absStart, buffer.span, notes),
    message: mode === 'transposed' ? '移調して貼り付けました' : '貼り付けました',
  };
}
