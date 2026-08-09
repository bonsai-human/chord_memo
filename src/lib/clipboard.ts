import type { Chord, EffectiveSettings, Project, Slot, SlotRef } from '../types';
import { measureLength, normalizeProject, resolveMeasureSettings } from './measures';
import { getPitchClassName, rootOffset } from './musicTheory';
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

export interface CopyBuffer {
  measures: CopiedMeasure[];
  chords: Record<string, Chord>;
}

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
    buffer: { measures, chords },
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
  buffer: CopyBuffer,
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
    const semitones =
      mode === 'transposed'
        ? (rootOffset(settings.key) - rootOffset(copied.effectiveKey) + 12) % 12
        : 0;

    const mapChordId = (id: string | null): string | null => {
      if (!id) return null;
      const cacheKey = mode === 'transposed' ? `${id}_T${semitones}` : id;
      if (!idMap[cacheKey]) {
        const newId = generateUUID();
        const source = buffer.chords[id];
        if (source) {
          const chord = mode === 'transposed' ? transposeChord(source, semitones, settings.key) : source;
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

    // そのまま貼り付けのときは、元の小節設定を貼り付け先へ持ち込む
    if (mode === 'normal') {
      const current = resolveMeasureSettings(cursor, project, measures);
      const { key, tempo, timeSignature } = copied.metadata;
      if (key && key !== current.key) measures[cursor].key = key;
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
