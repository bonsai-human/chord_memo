export type Quality = '' | 'm' | 'sus2' | 'sus4' | 'aug' | 'dim';
export type Fifth = '' | 'b5';
export type Seventh = '' | '7' | 'M7' | 'dim7';
export type Tension = '9' | 'b9' | '#9' | '11' | '#11' | '13' | 'b13';
export type Omit3or5 = '3rd' | '5th';
export type SwingResolution = '8n' | '16n';

export type InstrumentId =
  | 'piano'
  | 'guitar-acoustic'
  | 'organ'
  | 'guitar-electric'
  | 'violin'
  | 'synth-lead';

export interface Chord {
  id: string;
  root: string;
  quality: Quality;
  fifth: Fifth;
  seventh: Seventh;
  tensions: Tension[];
  onChord: string;
  isDimMode: boolean;
  isNC: boolean;
  omits: Omit3or5[];
}

export interface Slot {
  chordId: string | null;
  /** 4分音符 = 1 を単位とする長さ */
  duration: number;
}

/**
 * メロディーの1マス。コードのスロットとは別の刻みを持つ。
 * pitch は MIDI 番号（60 = C4）。度数表示はその位置のキーから導く
 */
/**
 * メロディーの音。休符は「音が無い」ことで表すので実体を持たない。
 * 小節をまたぐ音は duration が小節の残りを超えるだけで、タイは使わない。
 */
export interface MelodyNote {
  /** 小節の頭からの位置（4分音符 = 1） */
  start: number;
  /** 長さ（4分音符 = 1）。小節の残りを超えてよい */
  duration: number;
  /** MIDI ノート番号 */
  pitch: number;
}

export interface Measure {
  id: string;
  slots: Slot[];
  /** メロディー。start 昇順で、時間軸上で重ならない */
  melody?: MelodyNote[];
  timeSignature?: [number, number];
  tempo?: number;
  key?: string;
  swing?: number;
  swingResolution?: SwingResolution;
  label?: string;
  referenceLabel?: string;
  referenceLoopCount?: number;
  isReferenceExpanded?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  tempo: number;
  key: string;
  timeSignature: [number, number];
  instrument: InstrumentId;
  voicingOptimize: boolean;
  voicingMin: number;
  voicingMax: number;
  loopEnabled: boolean;
  metronomeEnabled: boolean;
  /** 演奏音の音量（0-100） */
  masterVolume: number;
  /** メロディーの音色。コードに埋もれないよう別に持つ */
  melodyInstrument: InstrumentId;
  /** メロディーの音量（0-100） */
  melodyVolume: number;
  audioUrl?: string;
  audioOffset: number;
  audioVolume: number;
  audioEnabled: boolean;
  youtubeUrl?: string;
  useYoutubeAudio: boolean;
  swingResolution: SwingResolution;
  measures: Measure[];
  chords: Record<string, Chord>;
  createdAt: number;
  updatedAt: number;
}

/** 小節位置における実効設定 */
export interface EffectiveSettings {
  key: string;
  tempo: number;
  timeSignature: [number, number];
  isOverride: {
    key: boolean;
    tempo: boolean;
    timeSignature: boolean;
  };
}

export interface SlotRef {
  measureId: string;
  slotIndex: number;
  loopCurrent?: number;
  sourceMeasureId?: string;
  expansionIndex?: number;
}
