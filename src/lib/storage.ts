import type { Chord, InstrumentId, Measure, Project, Slot } from '../types';

const STORAGE_KEY = 'chord_memo_projects';
const DEFAULT_SLOT_COUNT = 4;

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
    onChord: 'C',
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

  const measures: Measure[] = raw.measures.map((m: any) => ({
    ...m,
    tempo: m.tempo || undefined,
    key: m.key || undefined,
    timeSignature: m.timeSignature || undefined,
    swing: m.swing,
    swingResolution: m.swingResolution || undefined,
    slots: m.slots.map((s: any) => ({ ...s, duration: s.duration || 1 })),
  }));

  // 元実装は 'xylophone' を 'electric-piano' に変換していたが、その音色は定義に存在せず
  // 音が鳴らなくなるため 'piano' にフォールバックする
  const instrument: InstrumentId =
    raw.instrument === 'xylophone' || raw.instrument === 'electric-piano'
      ? 'piano'
      : raw.instrument || 'piano';

  return {
    ...raw,
    key: raw.key || 'C',
    instrument,
    voicingOptimize: raw.voicingOptimize ?? true,
    voicingMin: raw.voicingMin ?? 48,
    voicingMax: raw.voicingMax ?? 72,
    loopEnabled: raw.loopEnabled ?? false,
    metronomeEnabled: raw.metronomeEnabled ?? false,
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
