import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Chord, Measure, MelodySlot, Project, SlotRef } from './types';
import * as storage from './lib/storage';
import {
  melodyOf,
  normalizeProject,
  resolveMeasureSettings,
  splitMelodyRhythm,
  splitRhythm,
  transposeProject,
  updateMeasureSettings,
  type RhythmDivision,
} from './lib/measures';
import * as audio from './lib/audio';
import {
  copyRange,
  pasteBuffer,
  resolveRange,
  type CopyBuffer,
  type PasteMode,
} from './lib/clipboard';
import { useHistory } from './hooks/useHistory';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ChordGrid from './components/ChordGrid';
import ActionBar, { type Anchor, type MenuKind } from './components/ActionBar';
import ChordKeyboard from './components/ChordKeyboard';
import MelodyKeyboard from './components/MelodyKeyboard';
import PopupMenu, { type MenuItem } from './components/PopupMenu';
import SettingModal, { type SettingType } from './components/SettingModal';
import GeneralSettingsModal from './components/GeneralSettingsModal';
import HistoryModal from './components/HistoryModal';
import ConfirmDialog from './components/ConfirmDialog';
import AudioSyncModal from './components/AudioSyncModal';
import ExportModal, { type ExportFormat } from './components/ExportModal';
import HelpModal from './components/HelpModal';
import YouTubePlayer from './components/YouTubePlayer';
import * as audioStore from './lib/audioStore';
import { toChordPro, toRechord } from './lib/exporters';
import { parseImport } from './lib/importers';

const MOBILE_BREAKPOINT = 768;

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= MOBILE_BREAKPOINT);
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);

  const [selectedSlot, setSelectedSlot] = useState<SlotRef | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<SlotRef | null>(null);
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [editMode, setEditMode] = useState<'chord' | 'melody'>('chord');
  const [useDegreeNotation, setUseDegreeNotation] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isInstrumentLoading, setIsInstrumentLoading] = useState(false);
  const [playingSlot, setPlayingSlot] = useState<{
    measureIndex: number;
    slotIndex: number;
    melodyIndex?: number | null;
    loopInfo?: { current: number; total: number };
  } | null>(null);

  const [menu, setMenu] = useState<{ kind: MenuKind; anchor: Anchor } | null>(null);
  const [settingModal, setSettingModal] = useState<SettingType | null>(null);
  const [showGeneralSettings, setShowGeneralSettings] = useState(false);
  const [showAudioSync, setShowAudioSync] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [copyBuffer, setCopyBuffer] = useState<CopyBuffer | null>(null);

  const history = useHistory();
  const gridScrollRef = useRef<HTMLDivElement>(null);

  // --- 初期化 ---

  useEffect(() => {
    const stored = storage.getAllProjects();
    if (stored.length > 0) {
      setProjects(stored);
      setProject(normalizeProject(stored[0]));
    } else {
      const created = normalizeProject(storage.createEmptyProject());
      storage.saveProject(created);
      setProjects([created]);
      setProject(created);
    }
  }, []);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      // 狭い画面ではサイドバーが本文を覆うので開いたままにしない
      if (mobile) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 再生位置が画面の外へ出たらグリッドを追従させる。
  // 参照小節を展開中は同じ id のスロットが複数並ぶため、先頭のものが対象になる
  const playingMeasureIndex = playingSlot?.measureIndex;
  const playingSlotIndex = playingSlot?.slotIndex;
  const playingMelodyIndex = playingSlot?.melodyIndex;
  useEffect(() => {
    if (!isPlaying || playingMeasureIndex === undefined || playingSlotIndex === undefined) return;
    const container = gridScrollRef.current;
    const measure = project?.measures[playingMeasureIndex];
    if (!container || !measure) return;

    const prefix = editMode === 'melody' ? 'melody' : 'slot';
    const index = editMode === 'melody' ? playingMelodyIndex : playingSlotIndex;
    if (index === null || index === undefined) return;
    const slot = document.getElementById(`${prefix}-${measure.id}-${index}`);
    if (!slot) return;

    const view = container.getBoundingClientRect();
    const target = slot.getBoundingClientRect();
    // 端に達してから動かすと気づきにくいので、1行ぶん手前で追従を始める
    const margin = target.height * 1.5;
    if (target.top >= view.top + margin && target.bottom <= view.bottom - margin) return;

    container.scrollBy({ top: target.top - view.top - view.height / 3, behavior: 'smooth' });
  }, [isPlaying, playingMeasureIndex, playingSlotIndex, playingMelodyIndex, project, editMode]);

  // --- 音源 ---

  const instrumentId = project?.instrument;
  useEffect(() => {
    if (!instrumentId) return;
    let cancelled = false;
    setIsInstrumentLoading(true);
    audio
      .loadInstrument(instrumentId)
      .catch((e) => {
        console.error(e);
        if (!cancelled) setToast('音源の読み込みに失敗しました');
      })
      .finally(() => {
        if (!cancelled) setIsInstrumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [instrumentId]);

  const masterVolume = project?.masterVolume;
  useEffect(() => {
    if (masterVolume !== undefined) audio.setVolume(masterVolume);
  }, [masterVolume]);

  const melodyInstrument = project?.melodyInstrument;
  useEffect(() => {
    if (!melodyInstrument) return;
    audio.loadMelodyInstrument(melodyInstrument).catch((e) => console.error(e));
  }, [melodyInstrument]);

  const melodyVolume = project?.melodyVolume;
  useEffect(() => {
    if (melodyVolume !== undefined) audio.setMelodyVolume(melodyVolume);
  }, [melodyVolume]);

  useEffect(() => () => audio.stop(), []);

  // 選択中プロジェクトのオーディオを IndexedDB から復帰させる
  const projectId = project?.id;
  const audioEnabled = project?.audioEnabled;
  useEffect(() => {
    if (!projectId) return;
    let objectUrl: string | null = null;
    if (!audioEnabled) {
      audio.clearReferenceAudio();
      return;
    }
    audioStore
      .getAudio(projectId)
      .then((blob) => {
        if (!blob) return;
        objectUrl = URL.createObjectURL(blob);
        return audio.loadReferenceAudio(objectUrl);
      })
      .catch((e) => console.error('Failed to restore audio:', e));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, audioEnabled]);


  // --- 保存 ---

  const commit = useCallback((next: Project) => {
    const normalized = normalizeProject(next);
    setProject(normalized);
    storage.saveProject(normalized);
    setProjects((list) => list.map((p) => (p.id === normalized.id ? normalized : p)));
  }, []);

  /** 履歴から復元した状態を反映する（正規化済みなので保存だけ行う） */
  const restore = useCallback((next: Project) => {
    setProject(next);
    storage.saveProject(next);
    setProjects((list) => list.map((p) => (p.id === next.id ? next : p)));
  }, []);

  const resolveSettings = useCallback(
    (index: number) => resolveMeasureSettings(index, project),
    [project],
  );

  const handleSelectAudioFile = useCallback(
    async (file: File) => {
      if (!project) return;
      try {
        await audioStore.saveAudio(project.id, file);
        const url = URL.createObjectURL(file);
        await audio.loadReferenceAudio(url);
        // 頭の無音を読み飛ばした位置を初期値にする
        const detected = audio.detectAudioStart();
        commit({
          ...project,
          audioEnabled: true,
          useYoutubeAudio: false,
          audioUrl: url,
          audioOffset: Math.round(detected * 100) / 100,
        });
        setToast('音源を読み込みました');
      } catch (e) {
        console.error(e);
        setToast('音源の読み込みに失敗しました');
      }
    },
    [project, commit],
  );

  // --- 選択 ---

  const selectedMeasure = useMemo(
    () => project?.measures.find((m) => m.id === selectedSlot?.measureId) ?? null,
    [project, selectedSlot],
  );

  const selectedMeasureIndex = useMemo(
    () => project?.measures.findIndex((m) => m.id === selectedSlot?.measureId) ?? -1,
    [project, selectedSlot],
  );

  const selectedChord = useMemo((): Chord | null => {
    if (!project || !selectedSlot || !selectedMeasure) return null;
    const chordId = selectedMeasure.slots[selectedSlot.slotIndex]?.chordId;
    return chordId ? (project.chords[chordId] ?? null) : null;
  }, [project, selectedSlot, selectedMeasure]);

  const voicingOptions = useMemo(
    () => ({
      optimize: project?.voicingOptimize ?? true,
      min: project?.voicingMin ?? 48,
      max: project?.voicingMax ?? 72,
    }),
    [project?.voicingOptimize, project?.voicingMin, project?.voicingMax],
  );

  const handleSelectSlot = useCallback(
    (measureId: string, slotIndex: number, shiftKey: boolean) => {
      // 範囲選択モードでは1回目のタップで始点、2回目で終点を置く
      if (isRangeMode && selectedSlot && (shiftKey || !selectionEnd)) {
        setSelectionEnd({ measureId, slotIndex });
        return;
      }
      setSelectedSlot({ measureId, slotIndex });
      setSelectionEnd(null);

      // 置いてあるコードを鳴らして確認できるようにする
      const measure = project?.measures.find((m) => m.id === measureId);
      const chordId = measure?.slots[slotIndex]?.chordId;
      const chord = chordId ? project?.chords[chordId] : null;
      if (chord && !isPlaying) void audio.playChord(chord, voicingOptions);
    },
    [isRangeMode, selectedSlot, selectionEnd, project, isPlaying, voicingOptions],
  );

  // --- コード編集 ---

  const updateChord = useCallback(
    (patch: Partial<Chord>) => {
      if (!project || !selectedSlot || !selectedMeasure) return;
      history.push(project, 'コード更新');

      const chords = { ...project.chords };
      const existingId = selectedMeasure.slots[selectedSlot.slotIndex]?.chordId;
      const base: Chord = existingId
        ? chords[existingId]
        : {
            ...storage.createEmptyChord(),
            root: resolveSettings(selectedMeasureIndex).key.replace(/m$/, ''),
          };

      const updated: Chord = { ...base, ...patch, id: existingId || base.id };
      chords[updated.id] = updated;

      const measures = project.measures.map((m) => {
        if (m.id !== selectedMeasure.id) return m;
        const slots = m.slots.map((s, i) =>
          i === selectedSlot.slotIndex ? { ...s, chordId: updated.id } : s,
        );
        return { ...m, slots };
      });

      commit({ ...project, measures, chords });
      if (!isPlaying) void audio.playChord(updated, voicingOptions);
    },
    [
      project,
      selectedSlot,
      selectedMeasure,
      selectedMeasureIndex,
      history,
      commit,
      resolveSettings,
      isPlaying,
      voicingOptions,
    ],
  );

  const deleteChordOnly = useCallback(() => {
    if (!project || !selectedSlot) return;
    const range = resolveRange(project, selectedSlot, selectionEnd);
    if (!range) return;

    // メロディー面では音を消す
    if (editMode === 'melody') {
      history.push(project, 'メロディー削除');
      const measures = project.measures.map((m, index) => {
        if (index < range.from || index > range.to) return m;
        const timeSignature = resolveMeasureSettings(index, project).timeSignature;
        const begin = index === range.from ? range.firstSlot : 0;
        const melodySlots = melodyOf(m, timeSignature);
        const end = index === range.to ? range.lastSlot : melodySlots.length - 1;
        return {
          ...m,
          melody: melodySlots.map((slot, i) =>
            i >= begin && i <= end ? { ...slot, pitch: null, tie: false } : slot,
          ),
        };
      });
      commit({ ...project, measures });
      setSelectionEnd(null);
      setToast('メロディーを削除しました');
      return;
    }

    history.push(project, 'コード削除');
    const measures = project.measures.map((m, index) => {
      if (index < range.from || index > range.to) return m;
      const begin = index === range.from ? range.firstSlot : 0;
      const end = index === range.to ? range.lastSlot : m.slots.length - 1;
      return {
        ...m,
        slots: m.slots.map((s, i) => (i >= begin && i <= end ? { ...s, chordId: null } : s)),
      };
    });

    commit({ ...project, measures });
    setSelectionEnd(null);
    setToast(selectionEnd ? '選択範囲のコードを削除しました' : 'コードを削除しました');
  }, [project, selectedSlot, selectionEnd, history, commit, editMode]);

  const deleteMeasure = useCallback(() => {
    if (!project || !selectedSlot) return;
    const range = resolveRange(project, selectedSlot, selectionEnd);
    if (!range) return;

    const targets = new Set(project.measures.slice(range.from, range.to + 1).map((m) => m.id));
    if (targets.size >= project.measures.length) {
      setToast('全ての小節を削除することはできません');
      return;
    }

    history.push(project, '小節削除');
    commit({ ...project, measures: project.measures.filter((m) => !targets.has(m.id)) });
    setSelectedSlot(null);
    setSelectionEnd(null);
    setToast(targets.size > 1 ? `${targets.size} 小節を削除しました` : '小節を削除しました');
  }, [project, selectedSlot, selectionEnd, history, commit]);

  const applyRhythm = useCallback(
    (division: RhythmDivision) => {
      if (!project || !selectedSlot) return;
      if (selectedMeasure?.referenceLabel) {
        setToast('参照小節のリズムは変更できません');
        return;
      }
      history.push(project, 'リズム分割');
      commit(
        editMode === 'melody'
          ? splitMelodyRhythm(project, selectedSlot.measureId, division)
          : splitRhythm(project, selectedSlot.measureId, division),
      );
      setToast(editMode === 'melody' ? 'メロディーの刻みを変えました' : 'リズムを分割しました');
    },
    [project, selectedSlot, selectedMeasure, history, commit],
  );

  const applyMeasureSetting = useCallback(
    (patch: Partial<Measure>) => {
      if (!project || !selectedSlot) return;
      if (selectedMeasure?.referenceLabel && !('referenceLabel' in patch)) {
        setToast('参照小節の設定は変更できません');
        return;
      }
      history.push(project, '小節更新');
      commit(updateMeasureSettings(project, selectedSlot.measureId, patch));
    },
    [project, selectedSlot, selectedMeasure, history, commit, editMode],
  );

  // --- メロディー編集 ---

  const selectedTimeSignature = useMemo(
    () => resolveSettings(Math.max(0, selectedMeasureIndex)).timeSignature,
    [resolveSettings, selectedMeasureIndex],
  );

  const selectedMelodySlot = useMemo((): MelodySlot | null => {
    if (!selectedMeasure || !selectedSlot) return null;
    return melodyOf(selectedMeasure, selectedTimeSignature)[selectedSlot.slotIndex] ?? null;
  }, [selectedMeasure, selectedSlot, selectedTimeSignature]);

  /** 選択位置より前で最後に置かれた音。次の音をこの近くに置く */
  const previousMelodyPitch = useMemo((): number | null => {
    if (!project || !selectedSlot || selectedMeasureIndex < 0) return null;
    for (let i = selectedMeasureIndex; i >= 0; i--) {
      const measure = project.measures[i];
      if (!measure.melody) continue;
      const upTo = i === selectedMeasureIndex ? selectedSlot.slotIndex : measure.melody.length;
      for (let s = Math.min(upTo, measure.melody.length) - 1; s >= 0; s--) {
        const pitch = measure.melody[s].pitch;
        if (pitch !== null) return pitch;
      }
    }
    return null;
  }, [project, selectedSlot, selectedMeasureIndex]);

  /** 次のマスへ進む。小節の終わりなら次の小節の頭へ */
  const advanceMelodySelection = useCallback(() => {
    if (!project || !selectedSlot || selectedMeasureIndex < 0) return;
    const measure = project.measures[selectedMeasureIndex];
    const length = melodyOf(measure, selectedTimeSignature).length;
    if (selectedSlot.slotIndex + 1 < length) {
      setSelectedSlot({ measureId: measure.id, slotIndex: selectedSlot.slotIndex + 1 });
      return;
    }
    const next = project.measures[selectedMeasureIndex + 1];
    if (next) setSelectedSlot({ measureId: next.id, slotIndex: 0 });
  }, [project, selectedSlot, selectedMeasureIndex, selectedTimeSignature]);

  /** メロディーの1マスを書き換える */
  const writeMelody = useCallback(
    (slotIndex: number, patch: Partial<MelodySlot>, label: string) => {
      if (!project || !selectedSlot) return;
      history.push(project, label);
      const measures = project.measures.map((m, index) => {
        if (m.id !== selectedSlot.measureId) return m;
        const timeSignature = resolveMeasureSettings(index, project).timeSignature;
        const melody = melodyOf(m, timeSignature).map((slot, i) =>
          i === slotIndex ? { ...slot, ...patch } : slot,
        );
        return { ...m, melody };
      });
      commit({ ...project, measures });
    },
    [project, selectedSlot, history, commit],
  );

  const inputMelody = useCallback(
    (patch: MelodySlot) => {
      if (!selectedSlot) return;
      writeMelody(selectedSlot.slotIndex, { pitch: patch.pitch, tie: patch.tie }, 'メロディー入力');
      if (patch.pitch !== null && !patch.tie && !isPlaying) {
        void audio.playMelodyNote(patch.pitch);
      }
      // ポチポチ打てるよう、入れたら次のマスへ進む
      if (!patch.tie) advanceMelodySelection();
    },
    [selectedSlot, writeMelody, advanceMelodySelection, isPlaying],
  );

  const shiftMelody = useCallback(
    (semitones: number) => {
      if (!selectedSlot || !selectedMelodySlot || selectedMelodySlot.pitch === null) return;
      const pitch = selectedMelodySlot.pitch + semitones;
      writeMelody(selectedSlot.slotIndex, { pitch }, 'メロディー変更');
      if (!isPlaying) void audio.playMelodyNote(pitch);
    },
    [selectedSlot, selectedMelodySlot, writeMelody, isPlaying],
  );

  // --- コピー & ペースト ---

  const handleCopy = useCallback(() => {
    if (!project || !selectedSlot) return;
    if (editMode === 'melody') {
      setToast('メロディーのコピーはまだ対応していません');
      return;
    }
    const result = copyRange(project, selectedSlot, selectionEnd, resolveSettings);
    if (result.buffer) {
      setCopyBuffer(result.buffer);
      setSelectionEnd(null);
      setIsRangeMode(false);
    }
    setToast(result.message);
  }, [project, selectedSlot, selectionEnd, resolveSettings, editMode]);

  const handlePaste = useCallback(
    (mode: PasteMode) => {
      if (!project || !selectedSlot || !copyBuffer) return;
      if (editMode === 'melody') {
        setToast('メロディーへの貼り付けはまだ対応していません');
        return;
      }
      history.push(project, mode === 'transposed' ? '移調貼り付け' : '貼り付け');
      commit(pasteBuffer(project, copyBuffer, selectedSlot, mode));
      setToast(mode === 'transposed' ? '移調して貼り付けました' : '貼り付けました');
    },
    [project, selectedSlot, copyBuffer, history, commit, editMode],
  );

  // --- 再生 ---

  const stopPlayback = useCallback(() => {
    audio.stop();
    setIsPlaying(false);
    setPlayingSlot(null);
  }, []);

  const togglePlay = useCallback(() => {
    if (!project) return;
    if (isPlaying) {
      stopPlayback();
      return;
    }

    // 範囲を選んでいればその先頭から。単独選択ならその拍から鳴らす
    const range = selectedSlot ? resolveRange(project, selectedSlot, selectionEnd) : null;
    const from = range
      ? { measureIndex: range.from, slotIndex: range.firstSlot }
      : selectedSlot && selectedMeasureIndex >= 0
        ? { measureIndex: selectedMeasureIndex, slotIndex: selectedSlot.slotIndex }
        : undefined;

    // 範囲を選んでいるときのループは、その範囲だけを繰り返す
    const loopRange =
      range && selectionEnd
        ? {
            from: { measureIndex: range.from, slotIndex: range.firstSlot },
            to: { measureIndex: range.to, slotIndex: range.lastSlot },
          }
        : undefined;

    setIsPlaying(true);
    audio
      .playGrid({
        project,
        from,
        loopRange,
        onSlot: (event) =>
          setPlayingSlot((current) => ({
            measureIndex: event.measureIndex,
            slotIndex: event.slotIndex,
            melodyIndex: current?.melodyIndex,
            loopInfo: event.loopInfo,
          })),
        onMelody: (event) =>
          setPlayingSlot((current) => ({
            measureIndex: event.measureIndex,
            slotIndex: current?.slotIndex ?? 0,
            melodyIndex: event.melodyIndex ?? null,
            loopInfo: event.loopInfo,
          })),
        onEnd: () => {
          setIsPlaying(false);
          setPlayingSlot(null);
        },
      })
      .catch((e) => {
        console.error(e);
        setToast('再生に失敗しました');
        setIsPlaying(false);
        setPlayingSlot(null);
      });
  }, [project, isPlaying, selectedSlot, selectionEnd, selectedMeasureIndex, stopPlayback]);

  const toggleExpansion = useCallback(
    (measureId: string) => {
      if (!project) return;
      const measures = project.measures.map((m) =>
        m.id === measureId ? { ...m, isReferenceExpanded: !m.isReferenceExpanded } : m,
      );
      commit({ ...project, measures });
    },
    [project, commit],
  );

  // --- プロジェクト操作 ---

  const createProject = () => {
    const created = normalizeProject(storage.createEmptyProject());
    storage.saveProject(created);
    setProjects((list) => [...list, created]);
    setProject(created);
    setSelectedSlot(null);
  };

  const duplicateProject = (id: string) => {
    const source = projects.find((p) => p.id === id);
    if (!source) return;
    const copy = normalizeProject({
      ...(JSON.parse(JSON.stringify(source)) as Project),
      id: storage.generateUUID(),
      name: `${source.name} のコピー`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    storage.saveProject(copy);
    setProjects((list) => [...list, copy]);
    setProject(copy);
    setSelectedSlot(null);
    setSelectionEnd(null);

    // 同期音源も引き継ぐ。実体は IndexedDB にあるので別途コピーする
    audioStore
      .getAudio(id)
      .then((blob) => blob && audioStore.saveAudio(copy.id, blob))
      .catch((e) => console.error('Failed to copy audio:', e));

    setToast('プロジェクトを複製しました');
  };

  const transposeWholeProject = (semitones: number) => {
    if (!project) return;
    history.push(project, '曲全体を移調');
    commit(transposeProject(project, semitones));
  };

  const renameProject = (id: string, name: string) => {
    const target = projects.find((p) => p.id === id);
    if (!target) return;
    const updated = { ...target, name };
    storage.saveProject(updated);
    setProjects((list) => list.map((p) => (p.id === id ? updated : p)));
    if (project?.id === id) setProject(updated);
  };

  const removeProject = (id: string) => {
    storage.deleteProject(id);
    const remaining = projects.filter((p) => p.id !== id);
    if (remaining.length > 0) {
      setProjects(remaining);
      if (project?.id === id) setProject(normalizeProject(remaining[0]));
    } else {
      const created = normalizeProject(storage.createEmptyProject());
      storage.saveProject(created);
      setProjects([created]);
      setProject(created);
    }
    setSelectedSlot(null);
  };

  const download = (content: string, extension: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${project?.name || 'project'}.${extension}`;
    // ブラウザによってはドキュメントに挿さっていないリンクのクリックが無視される。
    // blob URL の解放もダウンロードが始まってから行う
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast('ファイルを書き出しました');
  };

  const exportProject = (format: ExportFormat) => {
    if (!project) return;
    if (format === 'rechord') {
      download(toRechord(project), 'txt', 'text/plain;charset=utf-8');
    } else if (format === 'chordpro') {
      download(toChordPro(project), 'cho', 'text/plain;charset=utf-8');
    } else {
      download(JSON.stringify(project, null, 2), 'json', 'application/json');
    }
  };

  const importProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const fallbackName = file.name.replace(/\.[^.]+$/, '');
        const parsed = parseImport(e.target?.result as string, fallbackName);
        const imported = normalizeProject({
          ...parsed,
          id: storage.generateUUID(),
          name: `${parsed.name} (Imported)`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        storage.saveProject(imported);
        setProjects((list) => [...list, imported]);
        setProject(imported);
        setToast('プロジェクトを読み込みました');
      } catch (err) {
        console.error(err);
        setToast('読み込みに失敗しました。ファイル形式を確認してください。');
      }
    };
    reader.readAsText(file);
  };

  // --- ショートカット ---

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return;

      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteChordOnly();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        handleCopy();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        handlePaste('normal');
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        history.undo(project, restore, setToast);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteChordOnly, handleCopy, handlePaste, history, project, restore, togglePlay]);

  // --- メニュー ---

  const menuItems = (): MenuItem[] => {
    if (!menu || !project) return [];
    switch (menu.kind) {
      case 'rhythm':
        return [
          { label: '4分音符', hint: '1拍', onClick: () => applyRhythm('div4') },
          { label: '8分音符', hint: '0.5拍', onClick: () => applyRhythm('div8') },
          { label: '4分3連', hint: '2拍を3分割', onClick: () => applyRhythm('div4t') },
          { label: '8分3連', hint: '1拍を3分割', onClick: () => applyRhythm('div8t') },
          { label: '16分音符', hint: '0.25拍', onClick: () => applyRhythm('div16') },
        ];
      case 'paste':
        return [
          { label: 'そのまま貼り付け', onClick: () => handlePaste('normal') },
          {
            label: 'キーに合わせて貼り付け',
            color: 'var(--accent)',
            onClick: () => handlePaste('transposed'),
          },
        ];
      case 'delete':
        return [
          { label: 'コードのみ削除', onClick: deleteChordOnly },
          { label: '小節ごと削除', color: 'var(--danger)', onClick: deleteMeasure },
        ];
      case 'settings': {
        const measure = selectedMeasure;
        return [
          { label: 'キー設定', checked: !!measure?.key, onClick: () => setSettingModal('key') },
          {
            label: 'テンポ設定',
            checked: !!measure?.tempo,
            onClick: () => setSettingModal('tempo'),
          },
          {
            label: '拍子設定',
            checked: !!measure?.timeSignature,
            onClick: () => setSettingModal('timeSignature'),
          },
          {
            label: 'スウィング',
            checked: measure?.swing !== undefined,
            onClick: () => setSettingModal('swing'),
          },
          {
            label: '参照再生',
            checked: !!measure?.referenceLabel,
            onClick: () => setSettingModal('reference'),
          },
        ];
      }
      case 'label':
        return [{ label: 'ラベルを設定', onClick: () => setSettingModal('label') }];
      case 'undo':
      case 'redo':
        return [{ label: '履歴を開く', onClick: () => setShowHistory(true) }];
      default:
        return [];
    }
  };

  if (!project) return null;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <Sidebar
        isOpen={isSidebarOpen}
        isMobile={isMobile}
        onRequestClose={() => setIsSidebarOpen(false)}
        projects={projects}
        currentProject={project}
        onSelect={(p) => {
          setProject(normalizeProject(p));
          setSelectedSlot(null);
          if (isMobile) setIsSidebarOpen(false);
        }}
        onCreate={createProject}
        onRename={renameProject}
        onDuplicate={duplicateProject}
        onDelete={(id) => setDeleteTarget(projects.find((p) => p.id === id) ?? null)}
        onExport={() => setShowExport(true)}
        onImport={importProject}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          isPlaying={isPlaying}
          isInstrumentLoading={isInstrumentLoading}
          onTogglePlay={togglePlay}
          currentProject={project}
          onOpenHelp={() => setShowHelp(true)}
          onOpenAudioSync={() => setShowAudioSync(true)}
          onOpenSettings={() => setShowGeneralSettings(true)}
          isRangeMode={isRangeMode}
          onToggleRangeMode={() => {
            const next = !isRangeMode;
            setIsRangeMode(next);
            setSelectionEnd(null);
            // 「1回目のタップで始点」にするため、入る前の選択は持ち込まない
            if (next) setSelectedSlot(null);
          }}
        />

        <div ref={gridScrollRef} style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-grid)' }}>
          <ChordGrid
            project={project}
            selectedSlot={selectedSlot}
            selectionEnd={selectionEnd}
            playingSlot={playingSlot}
            useDegreeNotation={useDegreeNotation}
            resolveSettings={resolveSettings}
            onSelectSlot={handleSelectSlot}
            onSelectChunk={(measureId, anchor) => {
              // 行ヘッダのクリックでその小節を選び、小節設定メニューを開く
              setSelectedSlot({ measureId, slotIndex: 0 });
              setSelectionEnd(null);
              setMenu({ kind: 'settings', anchor });
            }}
            onToggleExpansion={toggleExpansion}
            isMobile={isMobile}
            editMode={editMode}
          />
        </div>

        <div style={{ background: 'var(--bg-grid)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', background: 'var(--bg)' }}>
            {(
              [
                ['chord', 'コード'],
                ['melody', 'メロディー'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => {
                  if (mode === editMode) return;
                  // 刻みが違うので、選択は持ち越さない
                  setEditMode(mode);
                  setSelectedSlot(null);
                  setSelectionEnd(null);
                }}
                style={{
                  flex: 1,
                  padding: '8px',
                  border: 'none',
                  background: editMode === mode ? 'var(--panel)' : 'transparent',
                  color:
                    editMode === mode
                      ? mode === 'melody'
                        ? '#f472b6'
                        : 'var(--accent)'
                      : 'var(--text-muted)',
                  borderBottom:
                    editMode === mode
                      ? `2px solid ${mode === 'melody' ? '#f472b6' : 'var(--accent)'}`
                      : 'none',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <ActionBar
            canPaste={!!copyBuffer}
            canUndo={history.undoStack.length > 0}
            canRedo={history.redoStack.length > 0}
            isRangeMode={isRangeMode}
            hasSelection={!!selectedSlot}
            isMobile={isMobile}
            onOpenMenu={(kind, anchor) => setMenu({ kind, anchor })}
            onCopy={handleCopy}
            onPaste={() => handlePaste('normal')}
            onUndo={() => history.undo(project, restore, setToast)}
            onRedo={() => history.redo(project, restore, setToast)}
            onDelete={deleteChordOnly}
          />

          {editMode === 'melody' ? (
            <MelodyKeyboard
              selected={selectedMelodySlot}
              previousPitch={previousMelodyPitch}
              projectKey={
                selectedMeasureIndex >= 0 ? resolveSettings(selectedMeasureIndex).key : project.key
              }
              isSlotSelected={!!selectedSlot}
              onInput={inputMelody}
              onShift={shiftMelody}
            />
          ) : (
            <ChordKeyboard
              selectedChord={selectedChord}
              projectKey={
                selectedMeasureIndex >= 0 ? resolveSettings(selectedMeasureIndex).key : project.key
              }
              isSlotSelected={!!selectedSlot}
              useDegreeNotation={useDegreeNotation}
              onUpdateChord={updateChord}
            />
          )}
        </div>
      </div>

      {menu && <PopupMenu items={menuItems()} position={menu.anchor} onClose={() => setMenu(null)} />}

      {settingModal && selectedMeasure && (
        <SettingModal
          type={settingModal}
          project={project}
          measure={selectedMeasure}
          measureIndex={selectedMeasureIndex}
          onApply={applyMeasureSetting}
          onRemove={() => {
            const patch: Partial<Measure> = {};
            if (settingModal === 'key') patch.key = undefined;
            if (settingModal === 'tempo') patch.tempo = undefined;
            if (settingModal === 'timeSignature') patch.timeSignature = undefined;
            if (settingModal === 'swing') patch.swing = undefined;
            if (settingModal === 'reference') patch.referenceLabel = undefined;
            if (settingModal === 'label') patch.label = undefined;
            applyMeasureSetting(patch);
          }}
          onClose={() => setSettingModal(null)}
        />
      )}

      <YouTubePlayer visible={!!(project.useYoutubeAudio && project.youtubeUrl)} />

      {showAudioSync && (
        <AudioSyncModal
          project={project}
          onUpdate={(patch) => commit({ ...project, ...patch })}
          onSelectFile={handleSelectAudioFile}
          onClose={() => setShowAudioSync(false)}
        />
      )}

      {showGeneralSettings && (
        <GeneralSettingsModal
          project={project}
          useDegreeNotation={useDegreeNotation}
          onChangeDegreeNotation={setUseDegreeNotation}
          onUpdate={(patch) => commit({ ...project, ...patch })}
          onTranspose={transposeWholeProject}
          onClose={() => setShowGeneralSettings(false)}
        />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {showExport && (
        <ExportModal onExport={exportProject} onClose={() => setShowExport(false)} />
      )}

      {showHistory && (
        <HistoryModal
          undoStack={history.undoStack}
          redoStack={history.redoStack}
          onJump={(index, direction) => history.jumpTo(index, direction, project, restore, setToast)}
          onClose={() => setShowHistory(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="プロジェクトの削除"
          message={`プロジェクト '${deleteTarget.name}' を削除してもよろしいですか？`}
          onConfirm={() => removeProject(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {toast && (
        <div
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--border)',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            zIndex: 9999,
            cursor: 'pointer',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
