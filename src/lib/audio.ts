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

/**
 * 演奏音の出口。テンションを積んだ和音は同時発音数が多く、
 * 素通しだと簡単にクリップするのでリミッターを挟む。
 */
function output(): Tone.Volume {
  if (!volumeNode) {
    volumeNode = new Tone.Volume(0).connect(new Tone.Limiter(-1).toDestination());
  }
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

/** 音の立ち上がりを探す窓の長さ（秒） */
const ONSET_WINDOW = 0.02;
/** 曲中のいちばん大きい窓に対して、これを超えたら「鳴っている」とみなす（−20dB 相当） */
const ONSET_PEAK_RATIO = 0.1;

/**
 * 曲の頭の無音を読み飛ばした位置（秒）を返す。floorDb は絶対的な下限。
 *
 * 実際の音源はテープヒスやエンコーダのノイズを含み、1サンプルずつ絶対値を
 * 見るだけだと先頭で引っかかって 0 秒になってしまう。20ms ごとの RMS を出し、
 * 「曲中のいちばん大きい箇所に対して十分な大きさ」になる最初の窓を探す。
 */
export function detectAudioStart(floorDb = -40): number {
  const buffer = referencePlayer?.buffer?.get();
  if (!buffer) return 0;

  const rate = buffer.sampleRate;
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  if (channels.length === 0) return 0;
  const length = channels[0].length;
  /** その位置でいちばん大きいチャンネルの振幅 */
  const amplitude = (i: number) =>
    channels.reduce((max, data) => Math.max(max, Math.abs(data[i])), 0);

  const windowSize = Math.max(1, Math.round(rate * ONSET_WINDOW));
  const levels: number[] = [];
  let peak = 0;
  for (let i = 0; i < length; i += windowSize) {
    const end = Math.min(i + windowSize, length);
    let sum = 0;
    for (let j = i; j < end; j++) {
      const value = amplitude(j);
      sum += value * value;
    }
    const rms = Math.sqrt(sum / (end - i));
    levels.push(rms);
    if (rms > peak) peak = rms;
  }
  if (peak <= 0) return 0;

  const threshold = Math.max(Math.pow(10, floorDb / 20), peak * ONSET_PEAK_RATIO);
  const hit = levels.findIndex((level) => level >= threshold);
  if (hit <= 0) return 0;

  // 窓の頭で切ると音の立ち上がりを削るので、1つ前の窓まで戻って
  // 実際に振幅が出はじめる位置を拾う
  const searchFrom = (hit - 1) * windowSize;
  const searchTo = Math.min(length, (hit + 1) * windowSize);
  for (let i = searchFrom; i < searchTo; i++) {
    if (amplitude(i) > threshold / 4) return i / rate;
  }
  return (hit * windowSize) / rate;
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

/** 音域内でそのピッチクラスを鳴らせる MIDI 番号を全部並べる */
function candidatesInRange(pitch: number, min: number, max: number): number[] {
  const pitchClass = ((pitch % 12) + 12) % 12;
  const first = min + ((((pitchClass - min) % 12) + 12) % 12);
  const notes: number[] = [];
  for (let note = first; note <= max; note += 12) notes.push(note);
  return notes;
}

/** 音域の中央にいちばん近い候補を選ぶ（前のコードが無いとき） */
function nearestToCenter(pitch: number, min: number, max: number): number {
  const center = (min + max) / 2;
  const candidates = candidatesInRange(pitch, min, max);
  if (candidates.length === 0) return pitch;
  return candidates.reduce((best, note) =>
    Math.abs(note - center) < Math.abs(best - center) ? note : best,
  );
}

/**
 * 前のコードのボイシングに近い高さを選ぶ。
 * 各構成音について、音域内の候補のうち直前のどれかの音にいちばん近いものを採る。
 * 共通音は同じ高さのまま残り、その他も最短距離で動く。
 */
function leadFrom(pitch: number, previous: number[], min: number, max: number): number {
  const center = (min + max) / 2;
  const candidates = candidatesInRange(pitch, min, max);
  if (candidates.length === 0) return pitch;

  let best = candidates[0];
  let bestScore = Infinity;
  for (const note of candidates) {
    const movement = Math.min(...previous.map((p) => Math.abs(note - p)));
    // 動く量が同じなら音域の中央に近い方を選ぶ
    const score = movement + Math.abs(note - center) / 1000;
    if (score < bestScore) {
      bestScore = score;
      best = note;
    }
  }
  return best;
}

/**
 * 転回形の候補を並べる。
 * 下から順に積んだ形を1音ずつ回し、オクターブ単位でずらしたものを候補にする。
 * 音ごとに独立して高さを決めると和音が団子になり、C と B が半音で
 * ぶつかるような並びが出てしまうため、積み方ごと選ぶ。
 */
function voicingCandidates(pitchClasses: number[], min: number, max: number): number[][] {
  const unique = Array.from(new Set(pitchClasses));
  const candidates: number[][] = [];

  for (let rotation = 0; rotation < unique.length; rotation++) {
    const order = [...unique.slice(rotation), ...unique.slice(0, rotation)];
    const stacked: number[] = [];
    let last = -Infinity;
    for (const pitchClass of order) {
      let note = min + ((((pitchClass - min) % 12) + 12) % 12);
      while (note <= last) note += 12;
      stacked.push(note);
      last = note;
    }
    for (let shift = -24; shift <= 24; shift += 12) {
      const notes = stacked.map((note) => note + shift);
      if (notes[0] >= min && notes[notes.length - 1] <= max) candidates.push(notes);
    }
  }
  return candidates;
}

const average = (notes: number[]) => notes.reduce((sum, n) => sum + n, 0) / notes.length;
/** いちばん低い音と高い音の開き。広いほど和音がばらけて聞こえる */
const spread = (notes: number[]) => notes[notes.length - 1] - notes[0];

/** 前のボイシングから、各音がどれだけ動いたかの合計 */
function movementFrom(notes: number[], previous: number[]): number {
  return notes.reduce(
    (sum, note) => sum + Math.min(...previous.map((p) => Math.abs(note - p))),
    0,
  );
}

/** ベース音とコード音を分けて組み立てる */
export function buildVoicingParts(
  chord: Chord,
  voicing: VoicingOptions,
  previousTones?: number[],
): { bass: number; tones: number[] } {
  const root = rootOffset(chord.root);
  const bass = (chord.onChord ? rootOffset(chord.onChord) : root) + BASS_BASE;
  const intervals = getIntervals(chord);
  const raw = intervals.map((i) => root + i + CHORD_BASE);
  if (!voicing.optimize || raw.length === 0) return { bass, tones: raw };

  const center = (voicing.min + voicing.max) / 2;
  const hasPrevious = !!previousTones && previousTones.length > 0;

  // 候補は「転回形を積んだ形」と「音ごとに寄せた形」の両方。
  // 転回形だけだと、音数の多いコードで前のコードから離れた形が選ばれてしまう
  const candidates = voicingCandidates(
    intervals.map((i) => (((root + i) % 12) + 12) % 12),
    voicing.min,
    voicing.max,
  );
  candidates.push(
    raw.map((pitch) => nearestToCenter(pitch, voicing.min, voicing.max)).sort((a, b) => a - b),
  );
  if (hasPrevious) {
    candidates.push(
      raw
        .map((pitch) => leadFrom(pitch, previousTones!, voicing.min, voicing.max))
        .sort((a, b) => a - b),
    );
  }
  let best = candidates[0];
  let bestScore = Infinity;
  for (const notes of candidates) {
    // 前のコードがあれば動きの少なさで、無ければ和音の詰まり具合で選ぶ。
    // どちらも同点なら音域の中央に近い方
    const score = hasPrevious
      ? movementFrom(notes, previousTones!) + spread(notes) / 100
      : spread(notes) + Math.abs(average(notes) - center) / 10;
    const total = score + Math.abs(average(notes) - center) / 1000;
    if (total < bestScore) {
      bestScore = total;
      best = notes;
    }
  }

  return { bass, tones: best };
}

/**
 * コードを鳴らす音の並びを決める。
 * ベース音は固定で、コード音だけ音域内へ収める。
 * previousTones を渡すと、前のコードから動きが小さくなる高さを選ぶ。
 */
export function buildVoicing(
  chord: Chord,
  voicing: VoicingOptions,
  previousTones?: number[],
): number[] {
  const { bass, tones } = buildVoicingParts(chord, voicing, previousTones);
  return Array.from(new Set([bass, ...tones])).sort((a, b) => a - b);
}

const toNoteNames = (midi: number[]): string[] =>
  midi.map((m) => Tone.Frequency(m, 'midi').toNote());

/** 単発プレビューでも、続けて鳴らしたときにつながるよう直前の高さを覚えておく */
let previewTones: number[] = [];

/** 単発プレビュー */
export async function playChord(chord: Chord, voicing: VoicingOptions): Promise<void> {
  await Tone.start();
  const player = activeInstrument();
  player.releaseAll(Tone.now());
  if (chord.isNC) {
    previewTones = [];
    return;
  }
  const { bass, tones } = buildVoicingParts(chord, voicing, previewTones);
  previewTones = tones;
  const notes = Array.from(new Set([bass, ...tones])).sort((a, b) => a - b);
  player.triggerAttackRelease(toNoteNames(notes), '2n', Tone.now() + 0.01);
}

export function stop(): void {
  previewTones = [];
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
  voicings: Map<ScheduledEvent, number[]>,
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
    toNoteNames(voicings.get(active) ?? buildVoicing(active.chord, voicing)),
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

  // ボイシングは時間順に決める。前のコードからの動きを見るため、
  // 再生時のコールバックではなくここでまとめて求めておく
  const voicings = new Map<ScheduledEvent, number[]>();
  let previousTones: number[] = [];
  timeline.events.forEach((event) => {
    if (event.type !== 'chord' || !event.chord || event.chord.isNC) return;
    const { bass, tones } = buildVoicingParts(event.chord, voicing, previousTones);
    previousTones = tones;
    voicings.set(event, Array.from(new Set([bass, ...tones])).sort((a, b) => a - b));
  });

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
          toNoteNames(voicings.get(event) ?? buildVoicing(event.chord, voicing)),
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
    await startWithYouTube({ project, timeline, startAt, voicing, voicings, finish });
    return;
  }

  // オーディオファイルと同期する場合は Transport に乗せて一緒に走らせる
  if (project.audioEnabled && hasReferenceAudio() && referencePlayer) {
    setReferenceVolume(project.audioVolume ?? 80);
    referencePlayer.unsync();
    referencePlayer.sync().start(Tone.now() + 0.05, (project.audioOffset || 0) + startAt);
  }

  const now = Tone.now();
  if (startAt > 0) chaseCurrentChord(timeline, startAt, now, voicing, voicings);
  transport.seconds = startAt;
  transport.start(now + 0.05, startAt);
}

interface SyncArgs {
  project: Project;
  timeline: Timeline;
  startAt: number;
  voicing: VoicingOptions;
  /** 時間順に決めておいたボイシング */
  voicings: Map<ScheduledEvent, number[]>;
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
  voicings,
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
        chaseCurrentChord(timeline, at, now, voicing, voicings);
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
