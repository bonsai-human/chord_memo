import * as Tone from 'tone';
import type { Chord, InstrumentId, Project } from '../types';
import { getIntervals, rootOffset } from './musicTheory';
import { INSTRUMENTS, SAMPLE_BASE_URL } from './instruments';
import * as youtube from './youtube';
import { buildTimeline, timeOf, type ScheduledEvent, type Timeline } from './scheduler';

/** ベース音を置くオクターブ（MIDI） */
const BASS_BASE = 36;
/** コード音を置くオクターブ（MIDI） */
const CHORD_BASE = 48;

export interface VoicingOptions {
  optimize: boolean;
  min: number;
  max: number;
}

let instrument: Tone.Sampler | Tone.PolySynth | null = null;
let loadedId: InstrumentId | null = null;
/** 同じ音色のロードが重なって Sampler が二重に生まれるのを防ぐ */
let loadingId: InstrumentId | null = null;
let loadingPromise: Promise<void> | null = null;
let metronomeSynth: Tone.PolySynth | null = null;
let volumeNode: Tone.Volume | null = null;
let loopHandle: number | null = null;
/** 同期再生するオーディオファイル */
let referencePlayer: Tone.Player | null = null;
let referenceVolumeNode: Tone.Volume | null = null;

function output(): Tone.Volume {
  if (!volumeNode) volumeNode = new Tone.Volume(0).toDestination();
  return volumeNode;
}

function metronome(): Tone.PolySynth {
  if (!metronomeSynth) {
    metronomeSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { release: 0.1 },
    }).connect(output());
  }
  return metronomeSynth;
}

/** 音量（0-100）をデシベルに変換する */
export function setVolume(value: number): void {
  const normalized = Math.max(0, Math.min(100, value)) / 100;
  output().volume.value = normalized === 0 ? -Infinity : Tone.gainToDb(normalized);
}

function referenceOutput(): Tone.Volume {
  if (!referenceVolumeNode) referenceVolumeNode = new Tone.Volume(0).toDestination();
  return referenceVolumeNode;
}

/** 同期音源の音量（0-100） */
export function setReferenceVolume(value: number): void {
  const normalized = Math.max(0, Math.min(100, value)) / 100;
  referenceOutput().volume.value = normalized === 0 ? -Infinity : Tone.gainToDb(normalized);
}

export function loadReferenceAudio(url: string): Promise<void> {
  clearReferenceAudio();
  return new Promise((resolve, reject) => {
    const player = new Tone.Player({
      url,
      onload: () => resolve(),
      onerror: (e) => reject(e),
    }).connect(referenceOutput());
    referencePlayer = player;
  });
}

export function clearReferenceAudio(): void {
  if (!referencePlayer) return;
  referencePlayer.stop();
  referencePlayer.unsync();
  referencePlayer.dispose();
  referencePlayer = null;
}

export function hasReferenceAudio(): boolean {
  return !!referencePlayer?.buffer?.loaded;
}

/**
 * 曲の頭の無音を読み飛ばした位置（秒）を返す。threshold はデシベル。
 */
export function detectAudioStart(threshold = -40): number {
  const buffer = referencePlayer?.buffer?.get();
  if (!buffer) return 0;
  const data = buffer.getChannelData(0);
  const limit = Math.pow(10, threshold / 20);
  for (let i = 0; i < data.length; i++) {
    if (Math.abs(data[i]) > limit) return i / buffer.sampleRate;
  }
  return 0;
}

export function loadInstrument(id: InstrumentId): Promise<void> {
  if (loadedId === id && instrument) return Promise.resolve();
  // 同じ音色のロードが走っている間は、それに相乗りする
  if (loadingId === id && loadingPromise) return loadingPromise;

  instrument?.dispose();
  instrument = null;
  loadedId = null;
  loadingId = id;

  const def = INSTRUMENTS[id];

  loadingPromise = new Promise<void>((resolve, reject) => {
    if (!def || Object.keys(def.urls).length === 0) {
      // サンプルを持たない音色は合成音で代用する
      instrument = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.5, release: 0.4 },
      }).connect(output());
      resolve();
      return;
    }

    const sampler = new Tone.Sampler({
      urls: def.urls,
      baseUrl: SAMPLE_BASE_URL + def.path,
      onload: () => resolve(),
      onerror: (e) => reject(e),
    }).connect(output());
    instrument = sampler;
  })
    .then(() => {
      loadedId = id;
    })
    .finally(() => {
      if (loadingId === id) {
        loadingId = null;
        loadingPromise = null;
      }
    });

  return loadingPromise;
}

function activeInstrument(): Tone.Sampler | Tone.PolySynth {
  if (!instrument) {
    instrument = new Tone.PolySynth(Tone.Synth).connect(output());
    loadedId = 'synth-lead';
  }
  return instrument;
}

/**
 * コードを鳴らす音の並びを決める。
 * ベース音は固定で、コード音だけ音域の中心へ畳み込む。
 */
export function buildVoicing(chord: Chord, voicing: VoicingOptions): number[] {
  const root = rootOffset(chord.root);
  const bass = (chord.onChord ? rootOffset(chord.onChord) : root) + BASS_BASE;
  let notes = getIntervals(chord).map((i) => root + i + CHORD_BASE);

  if (voicing.optimize) {
    const center = (voicing.min + voicing.max) / 2;
    notes = notes.map((note) => {
      let value = note;
      while (value < voicing.min) value += 12;
      while (value > voicing.max) value -= 12;

      let best = value;
      if (value - 12 >= voicing.min && Math.abs(value - 12 - center) < Math.abs(best - center)) {
        best = value - 12;
      }
      if (value + 12 <= voicing.max && Math.abs(value + 12 - center) < Math.abs(best - center)) {
        best = value + 12;
      }
      return best;
    });
    notes.sort((a, b) => a - b);
  }

  return Array.from(new Set([bass, ...notes])).sort((a, b) => a - b);
}

const toNoteNames = (midi: number[]): string[] =>
  midi.map((m) => Tone.Frequency(m, 'midi').toNote());

/** 単発プレビュー */
export async function playChord(chord: Chord, voicing: VoicingOptions): Promise<void> {
  await Tone.start();
  const player = activeInstrument();
  player.releaseAll(Tone.now());
  if (chord.isNC) return;
  player.triggerAttackRelease(toNoteNames(buildVoicing(chord, voicing)), '2n', Tone.now() + 0.01);
}

export function stop(): void {
  if (loopHandle !== null) {
    cancelAnimationFrame(loopHandle);
    loopHandle = null;
  }
  const transport = Tone.getTransport();
  transport.stop();
  transport.cancel();
  transport.seconds = 0;
  instrument?.releaseAll();
  if (referencePlayer) {
    referencePlayer.stop();
    referencePlayer.unsync();
  }
  youtube.stop();
}

/**
 * 途中から再生するとき、その位置をまたいで鳴り続けているコードを拾って鳴らす。
 * 開始位置ちょうどに始まるコードは通常のスケジュールで鳴るため対象外にする
 * （含めると同じコードが二重に鳴る）。
 */
function chaseCurrentChord(
  timeline: Timeline,
  at: number,
  when: number,
  voicing: VoicingOptions,
): void {
  const active = timeline.events.find(
    (e) =>
      e.type === 'chord' &&
      e.chord &&
      !e.chord.isNC &&
      e.startTime < at - 0.001 &&
      e.startTime + e.duration > at + 0.001,
  );
  if (!active?.chord) return;
  const remaining = active.startTime + active.duration - at;
  activeInstrument().triggerAttackRelease(
    toNoteNames(buildVoicing(active.chord, voicing)),
    Math.max(0.1, remaining - 0.01),
    when,
  );
}

export interface PlayOptions {
  project: Project;
  /** 再生を始める位置（表示上の小節とスロット） */
  from?: { measureIndex: number; slotIndex: number };
  onSlot: (event: ScheduledEvent) => void;
  onEnd: () => void;
}

/** グリッド全体を再生する */
export async function playGrid({ project, from, onSlot, onEnd }: PlayOptions): Promise<void> {
  stop();
  await Tone.start();

  const timeline = buildTimeline(project, { metronome: project.metronomeEnabled });
  const transport = Tone.getTransport();
  transport.cancel();

  const voicing: VoicingOptions = {
    optimize: project.voicingOptimize,
    min: project.voicingMin,
    max: project.voicingMax,
  };

  const startAt = from ? timeOf(timeline, from.measureIndex, from.slotIndex) : 0;
  const player = activeInstrument();

  timeline.events.forEach((event) => {
    transport.schedule((time) => {
      if (event.type === 'metronome') {
        metronome().triggerAttackRelease(
          event.isDownbeat ? 'C5' : 'C4',
          '32n',
          time,
          event.isDownbeat ? 1 : 0.7,
        );
        return;
      }

      onSlot(event);

      if (event.type !== 'chord') return;
      if (event.chord && !event.chord.isNC) {
        player.triggerAttackRelease(
          toNoteNames(buildVoicing(event.chord, voicing)),
          Math.max(0.1, event.duration - 0.05),
          time,
        );
      } else {
        player.releaseAll(time);
      }
    }, event.startTime);
  });

  if (project.loopEnabled) {
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = timeline.totalDuration;
  } else {
    transport.loop = false;
    // stop() は transport.cancel() を呼ぶため、コールバックの外へ逃がす
    transport.schedule(() => {
      setTimeout(() => {
        stop();
        onEnd();
      }, 0);
    }, timeline.totalDuration);
  }

  const finish = () => {
    stop();
    onEnd();
  };

  if (project.useYoutubeAudio && project.youtubeUrl) {
    await startWithYouTube({ project, timeline, startAt, voicing, finish });
    return;
  }

  // オーディオファイルと同期する場合は Transport に乗せて一緒に走らせる
  if (project.audioEnabled && hasReferenceAudio() && referencePlayer) {
    setReferenceVolume(project.audioVolume ?? 80);
    referencePlayer.unsync();
    referencePlayer.sync().start(Tone.now() + 0.05, (project.audioOffset || 0) + startAt);
  }

  const now = Tone.now();
  if (startAt > 0) chaseCurrentChord(timeline, startAt, now, voicing);
  transport.seconds = startAt;
  transport.start(now + 0.05, startAt);
}

interface SyncArgs {
  project: Project;
  timeline: Timeline;
  startAt: number;
  voicing: VoicingOptions;
  finish: () => void;
}

/** 動画の再生位置に Transport を追従させる許容誤差（秒） */
const SYNC_TOLERANCE = 0.05;
/** 動画が再生状態にならなくても諦めて start する時間（ミリ秒） */
const PLAY_WAIT_MS = 3000;

async function startWithYouTube({
  project,
  timeline,
  startAt,
  voicing,
  finish,
}: SyncArgs): Promise<void> {
  const transport = Tone.getTransport();
  const offset = project.audioOffset || 0;

  await youtube.initPlayer(project.youtubeUrl!);
  youtube.setVolume(project.audioVolume ?? 80);

  const target = startAt + offset;
  let lastTime = target;
  let started = false;
  let synced = false;
  const waitFrom = performance.now();

  const tick = () => {
    const state = youtube.getState();
    const videoTime = youtube.getCurrentTime();

    if (state === 'playing' || performance.now() - waitFrom > PLAY_WAIT_MS) {
      if (!started) {
        const now = Tone.now();
        const at = Math.max(startAt, videoTime - offset);
        chaseCurrentChord(timeline, at, now, voicing);
        transport.seconds = at;
        transport.start(now + 0.02, at);
        started = true;
        synced = true;
      }

      if (videoTime - offset >= timeline.totalDuration - 0.05) {
        if (project.loopEnabled) {
          youtube.seekTo(offset);
          transport.seconds = 0;
          lastTime = offset;
          loopHandle = requestAnimationFrame(tick);
          return;
        }
        finish();
        return;
      }

      if (videoTime !== lastTime) {
        lastTime = videoTime;
        const transportTime = transport.seconds + offset;
        if (synced) {
          if (Math.abs(videoTime - transportTime) > SYNC_TOLERANCE) {
            transport.seconds = Math.max(0, videoTime - offset);
          }
        } else if (videoTime >= target - 0.01) {
          transport.seconds = Math.max(startAt, videoTime - offset);
          synced = true;
        }
      }
    } else if (transport.state === 'started') {
      // 動画がまだ鳴っていない間は待たせる
      transport.pause();
    }

    loopHandle = requestAnimationFrame(tick);
  };

  youtube.play(target);
  loopHandle = requestAnimationFrame(tick);
}
