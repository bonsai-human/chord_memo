import type { Chord, InstrumentId, Measure, MelodyNote, Project, Slot } from '../types';

const STORAGE_KEY = 'chord_memo_projects';
const DEFAULT_SLOT_COUNT = 4;
/** 演奏音の既定音量。和音が重なっても歪まない値にしてある */
const DEFAULT_MASTER_VOLUME = 50;
/** メロディーの既定。コードをピアノにしたときに埋もれない音色を選ぶ */
const DEFAULT_MELODY_INSTRUMENT: InstrumentId = 'synth-lead';
const DEFAULT_MELODY_VOLUME = 50;

/**
 * メロディー音量スライダー 100% にあたるゲイン。
 * コードと重ねると 0.6 では歪み、0.3 でちょうど良かったので、
 * その 0.3 が 80% の位置に来るように上限を決めてある（0.3 ÷ 0.8）。
 * 目盛りの意味そのものなので、保存データの版と一緒にここで持つ。
 */
export const MELODY_GAIN_AT_FULL = 0.375;

/**
 * 保存データの版。読み込み時の変換に使う。
 *  1 … melodyVolume が「ゲイン×100」だった（100% = ゲイン 1.0）
 *  2 … melodyVolume は目盛りそのもの（100% = MELODY_GAIN_AT_FULL）
 */
const SCHEMA_VERSION = 2;

/** v1 の音量を新しい目盛りへ読み替える。上限で頭打ちになるだけで、音は大きくならない */
function migrateMelodyVolume(raw: any): number {
  if ((raw.schemaVersion ?? 1) >= 2) return raw.melodyVolume ?? DEFAULT_MELODY_VOLUME;
  const legacy = raw.melodyVolume;
  if (typeof legacy !== 'number') return DEFAULT_MELODY_VOLUME;
  return Math.min(100, Math.round(legacy / MELODY_GAIN_AT_FULL));
}

/**
 * メロディーを読む。
 *
 * 旧形式は「小節を埋めるスロットの列」で、休符は pitch: null、音を伸ばすときは
 * タイで表していた。新形式は音そのものの列（start と duration を持ち、休符は
 * 存在しない）なので、位置を積算しながら畳んで移す。タイは直前の音を伸ばす
 * だけなので、その音の duration に足す。**タイは小節をまたぐ**（旧実装の再生も
 * 直前のイベントを小節に関係なく伸ばしていた）ため、曲全体を通しで見る。
 */
function migrateMelody(rawMeasures: any[]): (MelodyNote[] | undefined)[] {
  const result: (MelodyNote[] | undefined)[] = rawMeasures.map(() => undefined);
  // 直前の音。タイで伸ばすときに小節をまたいで参照する
  let previous: MelodyNote | null = null;

  rawMeasures.forEach((m, index) => {
    const raw = m?.melody;
    if (!Array.isArray(raw) || raw.length === 0) return;

    // 新形式はそのまま。start を持つかどうかで見分ける
    if (typeof raw[0]?.start === 'number') {
      const notes: MelodyNote[] = raw
        .filter((n: any) => typeof n?.pitch === 'number' && n.duration > 0)
        .map((n: any) => ({ start: n.start, duration: n.duration, pitch: n.pitch }))
        .sort((a: MelodyNote, b: MelodyNote) => a.start - b.start);
      if (notes.length > 0) {
        result[index] = notes;
        previous = notes[notes.length - 1];
      }
      return;
    }

    const notes: MelodyNote[] = [];
    let position = 0;
    for (const slot of raw) {
      const duration = slot?.duration || 1;
      if (slot?.tie && previous) {
        previous.duration += duration;
      } else if (typeof slot?.pitch === 'number') {
        const note = { start: position, duration, pitch: slot.pitch };
        notes.push(note);
        previous = note;
      } else {
        // 休符は実体を持たない。ここで音の連なりが切れる
        previous = null;
      }
      position += duration;
    }
    if (notes.length > 0) result[index] = notes;
  });

  return result;
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export function createEmptyChord(): Chord {
  return {
    id: generateUUID(),
    root: 'C',
    quality: '',
    fifth: '',
    seventh: '',
    tensions: [],
    // 空はルートと同じ音を指す。ここを 'C' にすると C 以外のキーで
    // 作ったコードに /C のオンコードが付いてしまう
    onChord: '',
    isDimMode: false,
    isNC: false,
    omits: [],
  };
}

export function createEmptyMeasure(
  slotCount = DEFAULT_SLOT_COUNT,
  timeSignature?: [number, number],
  tempo?: number,
  key?: string,
  duration = 1,
): Measure {
  const slots: Slot[] = Array.from({ length: slotCount }, () => ({ chordId: null, duration }));
  return { id: generateUUID(), slots, timeSignature, tempo, key, swing: undefined };
}

export function createEmptyProject(): Project {
  const first = createEmptyMeasure(4, [4, 4], 120, 'C');
  return {
    id: generateUUID(),
    schemaVersion: SCHEMA_VERSION,
    name: '名称未設定のプロジェクト',
    description: '',
    tempo: 120,
    key: 'C',
    timeSignature: [4, 4],
    instrument: 'piano',
    voicingOptimize: true,
    voicingMin: 48,
    voicingMax: 72,
    loopEnabled: false,
    metronomeEnabled: false,
    masterVolume: DEFAULT_MASTER_VOLUME,
    melodyInstrument: DEFAULT_MELODY_INSTRUMENT,
    melodyVolume: DEFAULT_MELODY_VOLUME,
    audioOffset: 0,
    audioVolume: 80,
    audioEnabled: false,
    youtubeUrl: undefined,
    useYoutubeAudio: false,
    swingResolution: '8n',
    measures: [first],
    chords: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** コピー元のコードを複製して chords に登録し、新しい id を返す */
export function cloneChord(chord: Chord, chords: Record<string, Chord>): string {
  const id = generateUUID();
  chords[id] = {
    ...chord,
    id,
    tensions: [...(chord.tensions || [])],
    omits: [...(chord.omits || [])],
  };
  return id;
}

/** どのスロットからも参照されていないコードを捨てる */
export function cleanupOrphanedChords(project: Project): Project {
  const used = new Set<string>();
  project.measures.forEach((m) => {
    m.slots.forEach((s) => {
      if (s.chordId) used.add(s.chordId);
    });
  });
  const chords: Record<string, Chord> = {};
  Object.keys(project.chords).forEach((id) => {
    if (used.has(id)) chords[id] = project.chords[id];
  });
  return { ...project, chords };
}

/** 旧バージョンのデータを現行スキーマに合わせる */
function migrate(raw: any): Project {
  const chords: Record<string, Chord> = {};
  if (raw.chords) {
    Object.entries<any>(raw.chords).forEach(([id, c]) => {
      chords[id] = {
        ...c,
        fifth: c.fifth || '',
        seventh: c.seventh || '',
        tensions: Array.isArray(c.tensions) ? c.tensions : c.tension ? [c.tension] : [],
        onChord: c.onChord || '',
        isDimMode: c.isDimMode || false,
        omits: Array.isArray(c.omits) ? c.omits : [],
      };
    });
  }

  const melodies = migrateMelody(raw.measures);
  const measures: Measure[] = raw.measures.map((m: any, index: number) => ({
    ...m,
    tempo: m.tempo || undefined,
    key: m.key || undefined,
    timeSignature: m.timeSignature || undefined,
    swing: m.swing,
    swingResolution: m.swingResolution || undefined,
    slots: m.slots.map((s: any) => ({ ...s, duration: s.duration || 1 })),
    melody: melodies[index],
  }));

  // 元実装は 'xylophone' を 'electric-piano' に変換していたが、その音色は定義に存在せず
  // 音が鳴らなくなるため 'piano' にフォールバックする
  const instrument: InstrumentId =
    raw.instrument === 'xylophone' || raw.instrument === 'electric-piano'
      ? 'piano'
      : raw.instrument || 'piano';

  return {
    ...raw,
    schemaVersion: SCHEMA_VERSION,
    key: raw.key || 'C',
    instrument,
    voicingOptimize: raw.voicingOptimize ?? true,
    voicingMin: raw.voicingMin ?? 48,
    voicingMax: raw.voicingMax ?? 72,
    loopEnabled: raw.loopEnabled ?? false,
    metronomeEnabled: raw.metronomeEnabled ?? false,
    // 以前は演奏音と同期音源が audioVolume を共用していた。演奏音は分離する
    masterVolume: raw.masterVolume ?? DEFAULT_MASTER_VOLUME,
    melodyInstrument: raw.melodyInstrument || DEFAULT_MELODY_INSTRUMENT,
    melodyVolume: migrateMelodyVolume(raw),
    audioUrl: raw.audioUrl || undefined,
    audioOffset: raw.audioOffset ?? 0,
    audioVolume: raw.audioVolume ?? 80,
    audioEnabled: raw.audioEnabled ?? false,
    youtubeUrl: raw.youtubeUrl || undefined,
    useYoutubeAudio: raw.useYoutubeAudio ?? false,
    swingResolution: raw.swingResolution || '8n',
    measures,
    chords,
  };
}

export function getAllProjects(): Project[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return (JSON.parse(stored) as any[])
      .map(migrate)
      .filter((p) => p.measures && p.measures.length > 0 && Array.isArray(p.measures[0].slots));
  } catch (e) {
    console.error('Failed to parse projects', e);
    return [];
  }
}

export function saveProject(project: Project): void {
  const cleaned = cleanupOrphanedChords(project);
  const projects = getAllProjects();
  const index = projects.findIndex((p) => p.id === cleaned.id);
  if (index >= 0) {
    projects[index] = { ...cleaned, updatedAt: Date.now() };
  } else {
    projects.push({ ...cleaned, createdAt: Date.now(), updatedAt: Date.now() });
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function deleteProject(id: string): void {
  const remaining = getAllProjects().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
}
