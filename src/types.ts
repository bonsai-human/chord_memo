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

export interface Measure {
  id: string;
  slots: Slot[];
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
