import type { InstrumentId } from '../types';

/** tonejs-instruments のサンプル置き場 */
export const SAMPLE_BASE_URL = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

export interface InstrumentDef {
  name: string;
  path: string;
  /** 音名 → ファイル名。空なら合成音で鳴らす */
  urls: Record<string, string>;
}

/** ファイル名は ♯ を s に置き換えた形（C#2 → Cs2.mp3） */
const sample = (...notes: string[]): Record<string, string> =>
  Object.fromEntries(notes.map((n) => [n, `${n.replace('#', 's')}.mp3`]));

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  piano: {
    name: 'Piano',
    path: 'piano/',
    urls: sample('A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'),
  },
  'guitar-acoustic': {
    name: 'Guitar',
    path: 'guitar-acoustic/',
    urls: sample('F4', 'G2', 'G3', 'A2', 'A3', 'C3', 'C4', 'D2', 'D3', 'E2', 'E3'),
  },
  organ: {
    name: 'Organ',
    path: 'organ/',
    urls: sample('C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'A1', 'A2', 'A3'),
  },
  'guitar-electric': {
    name: 'Distortion Guitar',
    path: 'guitar-electric/',
    urls: sample(
      'D#3',
      'D#4',
      'D#5',
      'E2',
      'F#2',
      'F#3',
      'F#4',
      'F#5',
      'A2',
      'A3',
      'A4',
      'A5',
      'C3',
      'C4',
      'C5',
      'C6',
      'C#2',
    ),
  },
  violin: {
    name: 'Violin (Strings)',
    path: 'violin/',
    urls: sample('A3', 'A4', 'A5', 'A6', 'C4', 'C5', 'C6', 'C7', 'E4', 'E5', 'E6', 'G4', 'G5', 'G6'),
  },
  'synth-lead': { name: 'Synth Lead', path: '', urls: {} },
};
