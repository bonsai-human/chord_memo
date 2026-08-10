import type { Chord, Project, SwingResolution } from '../types';
import { lastContentIndex, measureLength, melodyOf } from './measures';

export interface ScheduledEvent {
  type: 'chord' | 'metronome' | 'progress_only' | 'melody';
  /** 曲頭からの秒数 */
  startTime: number;
  duration: number;
  /** 表示上の小節インデックス（参照展開では参照元の位置） */
  measureIndex: number;
  slotIndex: number;
  /** 実際に鳴っている小節のインデックス */
  sourceMeasureIndex: number;
  chord: Chord | null;
  key: string;
  tempo: number;
  isDownbeat?: boolean;
  /** melody のときの音高（MIDI）とマス番号 */
  pitch?: number;
  melodyIndex?: number;
  loopInfo?: { current: number; total: number };
  expansionIndex?: number;
}

export interface Timeline {
  events: ScheduledEvent[];
  totalDuration: number;
}

interface Options {
  metronome?: boolean;
}

interface PlanEntry {
  measure: Project['measures'][number];
  originalIndex: number;
  displayIndex: number;
  loopCurrent?: number;
  loopTotal?: number;
  expansionIndex?: number;
}

/**
 * スウィングによる遅延（秒）。
 * 8n は拍の裏（小数部 0.5）、16n は 0.25 / 0.75 を後ろへずらす。
 */
function swingDelay(
  position: number,
  resolution: SwingResolution,
  tempo: number,
  amount: number,
): number {
  const fraction = position % 1;
  if (resolution === '16n') {
    if (Math.abs(fraction - 0.25) < 0.001 || Math.abs(fraction - 0.75) < 0.001) {
      return (60 / tempo) * (1 / 12) * amount;
    }
  } else if (Math.abs(fraction - 0.5) < 0.001) {
    return (60 / tempo) * (1 / 6) * amount;
  }
  return 0;
}

/** 参照小節を展開した再生順を作る */
function buildPlan(project: Project): PlanEntry[] {
  const last = lastContentIndex(project.measures);
  const target = last === -1 ? [project.measures[0]] : project.measures.slice(0, last + 1);
  const plan: PlanEntry[] = [];

  target.forEach((measure, displayIndex) => {
    if (measure.referenceLabel) {
      const source = project.measures.filter((m) => m.label === measure.referenceLabel);
      const loops = measure.referenceLoopCount || 1;
      if (source.length > 0) {
        for (let loop = 0; loop < loops; loop++) {
          source.forEach((src, i) => {
            plan.push({
              measure: src,
              originalIndex: project.measures.indexOf(src),
              displayIndex,
              loopCurrent: loop + 1,
              loopTotal: loops,
              expansionIndex: i,
            });
          });
        }
        return;
      }
    }
    plan.push({ measure, originalIndex: displayIndex, displayIndex });
  });

  return plan;
}

/** プロジェクトを再生用のイベント列に変換する */
export function buildTimeline(project: Project, options: Options = {}): Timeline {
  const plan = buildPlan(project);
  const events: ScheduledEvent[] = [];

  let elapsed = 0; // 秒
  let position = 0; // 4分音符単位の累積位置
  let key = project.measures[0]?.key || project.key || 'C';
  let tempo = project.measures[0]?.tempo || project.tempo || 120;
  let timeSignature = project.measures[0]?.timeSignature || project.timeSignature || [4, 4];
  let resolution: SwingResolution = project.measures[0]?.swingResolution || project.swingResolution || '8n';

  plan.forEach((entry) => {
    const { measure, originalIndex, displayIndex, loopCurrent, loopTotal, expansionIndex } = entry;
    const loopInfo = loopCurrent ? { current: loopCurrent, total: loopTotal || 1 } : undefined;

    if (measure.key) key = measure.key;
    if (measure.tempo) tempo = measure.tempo;
    if (measure.timeSignature) timeSignature = measure.timeSignature;
    const measureResolution = measure.swingResolution || resolution;
    const barLength = measureLength(timeSignature);
    const swing = measure.swing ?? 0;

    // メロディーはコードと別の刻みを持つので、小節の頭から別に積む
    const measureStart = elapsed;
    const measurePosition = position;

    measure.slots.forEach((slot, slotIndex) => {
      const delay = (p: number) => swingDelay(p, measureResolution, tempo, swing);
      const startTime = elapsed + delay(position);
      const beats = slot.duration || 1;
      const duration = elapsed + beats * (60 / tempo) + delay(position + beats) - startTime;
      const chord = slot.chordId ? (project.chords[slot.chordId] ?? null) : null;

      if (options.metronome && position % 1 === 0) {
        events.push({
          type: 'metronome',
          startTime,
          duration: 0.1,
          measureIndex: displayIndex,
          slotIndex,
          sourceMeasureIndex: originalIndex,
          chord: null,
          key,
          tempo,
          isDownbeat: position % barLength < 0.001,
        });
      }

      const isFirstSlot = displayIndex === 0 && slotIndex === 0;
      if (chord || isFirstSlot) {
        events.push({
          type: 'chord',
          startTime,
          duration,
          measureIndex: displayIndex,
          slotIndex,
          sourceMeasureIndex: originalIndex,
          chord,
          key,
          tempo,
          loopInfo,
          expansionIndex,
        });
      } else {
        // コードのないスロットは直前のコードを伸ばし、位置表示だけ行う
        const previous = [...events].reverse().find((e) => e.type === 'chord');
        if (previous) previous.duration += beats * (60 / tempo);
        events.push({
          type: 'progress_only',
          startTime,
          duration,
          measureIndex: displayIndex,
          slotIndex,
          sourceMeasureIndex: originalIndex,
          chord: null,
          key,
          tempo,
          loopInfo,
          expansionIndex,
        });
      }

      position += beats;
      elapsed += beats * (60 / tempo);
    });

    // メロディー。小節をまたぐ音はそのぶん長いだけで、特別扱いはしない
    melodyOf(measure).forEach((note, melodyIndex) => {
      const delay = (p: number) => swingDelay(p, measureResolution, tempo, swing);
      const startTime = measureStart + note.start * (60 / tempo) + delay(measurePosition + note.start);
      const end = note.start + note.duration;
      const duration =
        measureStart + end * (60 / tempo) + delay(measurePosition + end) - startTime;

      events.push({
        type: 'melody',
        startTime,
        duration,
        measureIndex: displayIndex,
        slotIndex: melodyIndex,
        sourceMeasureIndex: originalIndex,
        chord: null,
        key,
        tempo,
        pitch: note.pitch,
        melodyIndex,
        loopInfo,
      });
    });

    resolution = measureResolution;
  });

  return { events, totalDuration: elapsed };
}

export interface SlotPosition {
  measureIndex: number;
  slotIndex: number;
}

/**
 * 選択範囲に対応する再生時間の範囲を返す（部分ループ用）。
 * 終端はコードの duration ではなく次のスロットの開始時刻で測る。
 * コードのイベントは後続の空スロットぶんまで伸ばされているため
 */
export function rangeBounds(
  timeline: Timeline,
  from: SlotPosition,
  to: SlotPosition,
): { start: number; end: number } {
  const events = timeline.events.filter(
    (e) => e.type === 'chord' || e.type === 'progress_only',
  );
  const at = (position: SlotPosition) =>
    events.findIndex(
      (e) => e.measureIndex === position.measureIndex && e.slotIndex === position.slotIndex,
    );

  const startIndex = at(from);
  const endIndex = at(to);
  const start = startIndex >= 0 ? events[startIndex].startTime : 0;
  const end =
    endIndex >= 0 && endIndex + 1 < events.length
      ? events[endIndex + 1].startTime
      : timeline.totalDuration;

  return { start, end: Math.max(end, start + 0.1) };
}

/** 指定した表示位置のイベント開始時刻を返す（途中再生用） */
export function timeOf(timeline: Timeline, measureIndex: number, slotIndex: number): number {
  const hit = timeline.events.find(
    (e) =>
      (e.type === 'chord' || e.type === 'progress_only') &&
      e.measureIndex === measureIndex &&
      e.slotIndex === slotIndex,
  );
  return hit?.startTime ?? 0;
}
