import type { Chord, EffectiveSettings, Measure, MelodySlot, Project } from '../types';
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
  return m.slots.some((s) => s.chordId !== null) || !!m.label || !!m.referenceLabel;
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

  return cleanupOrphanedChords({ ...project, measures });
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
        const nextMelody = m.melody?.map((slot) =>
          slot.pitch === null ? slot : { ...slot, pitch: slot.pitch + melodyShift },
        );
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
    const melody = measure.melody?.map((slot) =>
      slot.pitch === null ? slot : { ...slot, pitch: slot.pitch + nearestShift(shift) },
    );
    return { ...measure, slots, melody };
  });

  return normalizeProject({ ...shifted, measures, chords });
}

/** その小節のメロディー。未設定なら拍数ぶんの休符を返す */
export function melodyOf(measure: Measure, timeSignature: [number, number]): MelodySlot[] {
  if (measure.melody && measure.melody.length > 0) return measure.melody;
  return Array.from({ length: timeSignature[0] }, () => ({
    pitch: null,
    duration: 4 / timeSignature[1],
  }));
}

/** 曲中で使われている音高の範囲。メロディーの縦位置を決めるのに使う */
export function melodyRange(project: Project): { low: number; high: number } | null {
  let low = Infinity;
  let high = -Infinity;
  project.measures.forEach((measure) => {
    measure.melody?.forEach((slot) => {
      if (slot.pitch === null) return;
      if (slot.pitch < low) low = slot.pitch;
      if (slot.pitch > high) high = slot.pitch;
    });
  });
  return low === Infinity ? null : { low, high };
}

/** メロディーの刻みを変える。元の位置にあった音は引き継ぐ */
export function splitMelodyRhythm(
  project: Project,
  measureId: string,
  division: RhythmDivision,
): Project {
  const index = project.measures.findIndex((m) => m.id === measureId);
  if (index === -1) return project;

  const measures = [...project.measures];
  const target = measures[index];
  const timeSignature = resolveMeasureSettings(index, project, measures).timeSignature;
  const source = melodyOf(target, timeSignature);
  const total = measureLength(timeSignature);
  const unit = DIVISION_DURATION[division];
  const count = Math.round(total / unit);
  const epsilon = 0.001;

  const melody: MelodySlot[] = [];
  let position = 0;
  for (let i = 0; i < count; i++) {
    const duration = i === count - 1 ? Math.max(0.1, total - position) : unit;

    let picked: MelodySlot | null = null;
    let cursor = 0;
    for (const slot of source) {
      if (cursor + slot.duration > position + epsilon && cursor <= position + epsilon) {
        picked = slot;
        break;
      }
      cursor += slot.duration;
    }

    melody.push({ pitch: picked?.pitch ?? null, duration, tie: picked?.tie });
    position += duration;
  }

  measures[index] = { ...target, melody };
  return normalizeProject({ ...project, measures });
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
