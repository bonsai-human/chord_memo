import { useMemo } from 'react';
import type {
  Chord,
  EffectiveSettings,
  Measure,
  Project,
  Slot,
  SlotRef,
} from '../types';
import {
  buildChunks,
  measureLength,
  measureSpans,
  melodyRange,
  melodySegments,
  type MelodySegment,
} from '../lib/measures';
import {
  getChordName,
  getDegreeName,
  getNoteName,
  getScaleDegree,
  getTheoreticalKeyDisplay,
} from '../lib/musicTheory';

const DESKTOP_CONTENT_WIDTH = 968;
const BASE_FONT_DESKTOP = 1.1;
const BASE_FONT_MOBILE = 0.95;
const MIN_FONT = 0.5;
/** 1rem = 何 px か */
const ROOT_FONT_PX = 16;
/** スロット左右の内側余白 */
const SLOT_PADDING = 4;

let measureContext: CanvasRenderingContext2D | null | undefined;
const widthCache = new Map<string, number>();

/**
 * コード名を 1rem・太字で描いたときの幅（px）を実測する。
 * 文字数から見積もると "C" と "Cm7(b5)/G"、半角と全角の差を拾えないため、
 * canvas で実際に測ってキャッシュする。フォントサイズには比例するので
 * ここで得た幅に rem 値を掛ければ任意のサイズでの幅になる。
 */
function measureAtOneRem(name: string): number {
  const cached = widthCache.get(name);
  if (cached !== undefined) return cached;

  if (measureContext === undefined) {
    measureContext = document.createElement('canvas').getContext('2d');
    if (measureContext) {
      const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
      measureContext.font = `bold ${ROOT_FONT_PX}px ${family}`;
    }
  }
  // 計測できない環境では従来どおり文字数から見積もる
  const width = measureContext
    ? measureContext.measureText(name).width
    : name.length * ROOT_FONT_PX * 0.5;

  widthCache.set(name, width);
  return width;
}

interface FontResult {
  fontSize: number;
  needsExpansion: boolean;
}

/** コード名がスロットに収まるフォントサイズ（rem）を求める */
function fitChordName(
  name: string,
  slotWidth: number,
  displaySlots: number,
  isMobile: boolean,
): FontResult {
  const base = isMobile ? BASE_FONT_MOBILE : BASE_FONT_DESKTOP;
  const unitWidth = measureAtOneRem(name);
  if (unitWidth <= 0) return { fontSize: base, needsExpansion: false };

  // コードのない後続スロットぶんまで使える
  const available = Math.max(0, displaySlots * slotWidth - SLOT_PADDING);
  const fontSize = Math.min(base, Math.max(MIN_FONT, available / unitWidth));

  // 自分のスロットに収まるなら中央寄せのまま。収まらないときだけ
  // max-content にして後続の空きスロットへはみ出させる
  const needsExpansion = unitWidth * fontSize > slotWidth - SLOT_PADDING;
  return { fontSize, needsExpansion };
}

/** 選択範囲に含まれるか */
function isInSelection(
  measureIndex: number,
  slotIndex: number,
  measures: Measure[],
  start: SlotRef | null,
  end: SlotRef | null,
): boolean {
  if (!start) return false;
  if (!end) {
    return measures[measureIndex]?.id === start.measureId && slotIndex === start.slotIndex;
  }

  const a = measures.findIndex((m) => m.id === start.measureId);
  const b = measures.findIndex((m) => m.id === end.measureId);
  if (a === -1 || b === -1) return false;

  const [low, high] = [Math.min(a, b), Math.max(a, b)];
  if (low === high) {
    if (measureIndex !== low) return false;
    const [s, e] = [
      Math.min(start.slotIndex, end.slotIndex),
      Math.max(start.slotIndex, end.slotIndex),
    ];
    return slotIndex >= s && slotIndex <= e;
  }
  if (measureIndex < low || measureIndex > high) return false;
  if (measureIndex > low && measureIndex < high) return true;

  if (a < b) {
    if (measureIndex === a) return slotIndex >= start.slotIndex;
    if (measureIndex === b) return slotIndex <= end.slotIndex;
  } else {
    if (measureIndex === a) return slotIndex <= start.slotIndex;
    if (measureIndex === b) return slotIndex >= end.slotIndex;
  }
  return false;
}

interface SlotViewProps {
  slot: Slot;
  measure: Measure;
  slotIndex: number;
  chordName: string;
  displaySlots: number;
  slotWidth: number;
  isMobile: boolean;
  isSelected: boolean;
  isPlaying: boolean;
  inSelection: boolean;
  isReferenceOverlay: boolean;
  referenceLabelText: string | null;
  /** 参照小節を再生中に出す「現在の周回 / 総回数」 */
  loopProgress: string | null;
  onSelect: (e: React.MouseEvent) => void;
  onToggleExpansion: () => void;
}

function SlotView({
  slot,
  measure,
  slotIndex,
  chordName,
  displaySlots,
  slotWidth,
  isMobile,
  isSelected,
  isPlaying,
  inSelection,
  isReferenceOverlay,
  referenceLabelText,
  loopProgress,
  onSelect,
  onToggleExpansion,
}: SlotViewProps) {
  const { fontSize, needsExpansion } = chordName
    ? fitChordName(chordName, slotWidth, displaySlots, isMobile)
    : { fontSize: 1, needsExpansion: false };

  return (
    <div
      id={`slot-${measure.id}-${slotIndex}`}
      onClick={onSelect}
      style={{
        flex: slot.duration || 1,
        minWidth: 0,
        background: isPlaying ? 'var(--selected)' : inSelection ? 'var(--in-range)' : 'transparent',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        borderLeft: slotIndex > 0 ? '1px solid var(--border)' : 'none',
        position: 'relative',
        transition: 'background 0.1s ease-out',
        padding: '10px 0',
        outline: isSelected ? '2px solid #6366f1' : 'none',
        zIndex: isSelected ? 3 : chordName ? 2 : 1,
        opacity: isReferenceOverlay ? 0.6 : 1,
        minHeight: '40px',
      }}
    >
      {isReferenceOverlay && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 4,
            pointerEvents: 'none',
          }}
        >
          {slotIndex === 0 && referenceLabelText && (
            <span
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpansion();
                }}
                style={{
                  fontSize: '0.65rem',
                  color: 'var(--accent)',
                  background: 'var(--panel)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid var(--border)',
                  whiteSpace: 'nowrap',
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                }}
              >
                {referenceLabelText}
              </span>
              {loopProgress && (
                <span
                  style={{
                    fontSize: '0.6rem',
                    color: 'var(--accent-warm)',
                    fontWeight: 'bold',
                  }}
                >
                  {loopProgress}
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {chordName && (
        <div
          style={{
            width: needsExpansion ? 'max-content' : '100%',
            maxWidth: needsExpansion ? `${displaySlots * 100}%` : '100%',
            textAlign: 'center',
            fontWeight: 'bold',
            fontSize: `${fontSize}rem`,
            color: isPlaying ? 'white' : 'inherit',
            overflowWrap: 'anywhere',
            lineHeight: 1.1,
            pointerEvents: 'none',
            zIndex: 5,
            textShadow: '0 1px 2px rgba(0,0,0,0.3)',
            padding: needsExpansion ? '0 1px' : '0 2px',
            flexShrink: 0,
          }}
        >
          {chordName}
        </div>
      )}

      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '4px',
          background: isPlaying ? '#818cf8' : 'transparent',
          boxShadow: isPlaying ? '0 0 12px #6366f1' : 'none',
          zIndex: 2,
        }}
      />
    </div>
  );
}

/** メロディー面での小節の高さ。音高を縦位置で見せるため広くとる */
const MELODY_ROW_HEIGHT = 78;
/** 音を表す帯の高さ */
const NOTE_HEIGHT = 14;

/** 音の帯に載せる文字。0.65rem 太字で描く前提 */
const NOTE_LABEL_REM = 0.65;

/**
 * 帯に収まる範囲で音名を返す。
 * 幅が足りなければオクターブ番号を落とし、それでも無理なら諦める。
 * 音高は縦位置でも分かるので、無理に詰め込むより空ける方がよい。
 */
function fitNoteLabel(pitch: number, key: string, relative: boolean, width: number): string {
  if (relative) {
    const degree = getScaleDegree(pitch, key);
    return measureAtOneRem(degree) * NOTE_LABEL_REM <= width ? degree : '';
  }
  const full = getNoteName(pitch, key);
  if (measureAtOneRem(full) * NOTE_LABEL_REM <= width) return full;
  const withoutOctave = full.replace(/-?[0-9]+$/, '');
  return measureAtOneRem(withoutOctave) * NOTE_LABEL_REM <= width ? withoutOctave : '';
}

interface MelodyRowProps {
  /** この小節に描く音の片。小節をまたぐ音は前の小節から流れ込んでくる */
  segments: MelodySegment[];
  /** 背後に薄く出すコード。刻みが違うので別に受け取る */
  chordLabels: { name: string; duration: number }[];
  measureId: string;
  measureKey: string;
  /** キーに対する相対表記（移動ド）にするか */
  useDegreeNotation: boolean;
  /** マスの数と1マスの長さ。拍子どおりの等分 */
  cells: number;
  measureBeats: number;
  /** 小節の実幅（px）。音名が帯に収まるかの判定に使う */
  measureWidth: number;
  /** 曲中で使われている音高の範囲。縦位置の基準 */
  range: { low: number; high: number } | null;
  /** カーソルの位置（小節頭からの拍）。この小節にないときは null */
  cursor: number | null;
  /** 再生中に光らせる音。{ 小節 index, 音の index } で指す */
  playingNote: { ownerIndex: number; noteIndex: number } | null;
  /** いま編集の対象になっている音。同じ指し方 */
  selectedNote: { ownerIndex: number; noteIndex: number } | null;
  inSelection: (cellIndex: number) => boolean;
  onSelect: (cellIndex: number, shiftKey: boolean) => void;
}

/** メロディーの1小節。音高に応じて縦位置を変える */
function MelodyRow({
  segments,
  chordLabels,
  measureId,
  measureKey,
  useDegreeNotation,
  cells,
  measureBeats,
  measureWidth,
  range,
  cursor,
  playingNote,
  selectedNote,
  inSelection,
  onSelect,
}: MelodyRowProps) {
  // 音域が狭いと上下に張り付くので、最低1オクターブぶんは確保する
  const low = range ? Math.min(range.low, range.high - 11) : 60;
  const high = range ? Math.max(range.high, range.low + 11) : 71;

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        height: `${MELODY_ROW_HEIGHT}px`,
        position: 'relative',
      }}
    >
      {/* コードとの関係が見えるよう、背後に薄く出す */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          pointerEvents: 'none',
          // マスより上に置く。下に敷くと選択したマスの塗りに隠れてしまう
          zIndex: 2,
        }}
      >
        {chordLabels.map((label, index) => (
          <div
            key={index}
            style={{
              flex: label.duration || 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              paddingBottom: '4px',
              color: 'var(--text-muted)',
              fontSize: '0.8rem',
              fontWeight: 'bold',
              opacity: 0.5,
              overflow: 'hidden',
            }}
          >
            {label.name}
          </div>
        ))}
      </div>

      {/* 拍のマス。ここをタップして大まかな位置を決める */}
      {Array.from({ length: cells }, (_, index) => (
        <div
          key={index}
          id={`melody-${measureId}-${index}`}
          onClick={(e) => onSelect(index, e.shiftKey)}
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            cursor: 'pointer',
            borderLeft: index > 0 ? '1px solid var(--border)' : 'none',
            // 対象を示すのはカーソルと選択ノートなので、マスの塗りは控えめに
            background: inSelection(index) ? 'rgba(99, 102, 241, 0.18)' : 'transparent',
            zIndex: 1,
          }}
        />
      ))}

      {/* 音。位置と長さをそのまま帯にする。小節をまたぐ音は端を角ばらせる */}
      {segments.map((segment) => {
        const ratio = (segment.pitch - low) / (high - low);
        const isPlaying =
          playingNote?.ownerIndex === segment.ownerIndex &&
          playingNote?.noteIndex === segment.noteIndex;
        const isSelected =
          selectedNote?.ownerIndex === segment.ownerIndex &&
          selectedNote?.noteIndex === segment.noteIndex;
        const width = ((segment.to - segment.from) / measureBeats) * measureWidth - 4;
        return (
          <span
            key={`${segment.ownerIndex}-${segment.noteIndex}-${segment.from}`}
            id={segment.isStart ? `melody-note-${measureId}-${segment.noteIndex}` : undefined}
            style={{
              position: 'absolute',
              left: `calc(${(segment.from / measureBeats) * 100}% + 1px)`,
              width: `calc(${((segment.to - segment.from) / measureBeats) * 100}% - 2px)`,
              // 高い音ほど上に置く
              top: `${(1 - ratio) * (MELODY_ROW_HEIGHT - NOTE_HEIGHT - 8) + 4}px`,
              height: `${NOTE_HEIGHT}px`,
              borderRadius: `${segment.isStart ? 3 : 0}px ${segment.isEnd ? 3 : 0}px ${
                segment.isEnd ? 3 : 0
              }px ${segment.isStart ? 3 : 0}px`,
              background: isPlaying ? '#f9a8d4' : '#f472b6',
              // 選択中は白枠で囲む。どの音にアクションが効くかを一目で分かるように
              outline: isSelected ? '2px solid #e2e8f0' : 'none',
              boxShadow: isPlaying ? '0 0 10px #f472b6' : 'none',
              color: 'var(--bg)',
              fontSize: `${NOTE_LABEL_REM}rem`,
              fontWeight: 'bold',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          >
            {segment.isStart
              ? fitNoteLabel(segment.pitch, measureKey, useDegreeNotation, width)
              : ''}
          </span>
        );
      })}

      {/* カーソル。マスの途中にも立つので細い縦線で示す */}
      {cursor !== null && (
        <span
          style={{
            position: 'absolute',
            left: `${(cursor / measureBeats) * 100}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            // 小節の頭に立つときも線が枠に埋もれないよう内側へ寄せる
            transform: cursor <= 0 ? 'translateX(1px)' : 'translateX(-1px)',
            background: '#818cf8',
            boxShadow: '0 0 6px #6366f1',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {/* 縦線だけだと拍の区切りに紛れるので頭に印を付ける */}
          <span
            style={{
              position: 'absolute',
              top: 0,
              left: '-3px',
              width: '8px',
              height: '4px',
              borderRadius: '0 0 2px 2px',
              background: '#818cf8',
            }}
          />
        </span>
      )}
    </div>
  );
}

interface Props {
  project: Project;
  selectedSlot: SlotRef | null;
  selectionEnd: SlotRef | null;
  playingSlot: {
    measureIndex: number;
    slotIndex: number;
    /** メロディー面で光らせる音。音を持っている小節の index で指す */
    melodyIndex?: number | null;
    melodyOwnerIndex?: number | null;
    loopInfo?: { current: number; total: number };
  } | null;
  useDegreeNotation: boolean;
  resolveSettings: (index: number) => EffectiveSettings;
  onSelectSlot: (measureId: string, slotIndex: number, shiftKey: boolean) => void;
  /** メロディーのカーソル位置（小節頭からの拍） */
  melodyCursor: { measureId: string; start: number } | null;
  /** いま編集の対象になっているメロディーの音 */
  selectedMelodyNote: { ownerIndex: number; noteIndex: number } | null;
  onSelectChunk: (measureId: string, anchor: { top: number; left: number }) => void;
  onToggleExpansion: (measureId: string) => void;
  isMobile: boolean;
  /** コード面かメロディー面か */
  editMode: 'chord' | 'melody';
}

export default function ChordGrid({
  project,
  selectedSlot,
  selectionEnd,
  playingSlot,
  useDegreeNotation,
  resolveSettings,
  onSelectSlot,
  melodyCursor,
  selectedMelodyNote,
  onSelectChunk,
  onToggleExpansion,
  isMobile,
  editMode,
}: Props) {
  const chunks = useMemo(
    () => buildChunks(project.measures, resolveSettings),
    [project.measures, resolveSettings],
  );

  const contentWidth = isMobile ? window.innerWidth - 32 : DESKTOP_CONTENT_WIDTH;
  const melodyBounds = useMemo(() => melodyRange(project), [project]);
  const spans = useMemo(() => measureSpans(project), [project]);
  const segments = useMemo(
    () => (editMode === 'melody' ? melodySegments(project, spans) : []),
    [project, spans, editMode],
  );
  const hasExpanded = project.measures.some((m) => m.isReferenceExpanded && m.referenceLabel);

  const nameOf = (chordId: string | null, key: string): string => {
    if (!chordId) return '';
    const chord: Chord | undefined = project.chords[chordId];
    if (!chord) return '';
    return useDegreeNotation ? getDegreeName(chord, key) : getChordName(chord);
  };

  return (
    <div
      style={{
        padding: isMobile ? '10px' : '20px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: '100%',
        maxWidth: '1000px',
        margin: '0 auto',
      }}
    >
      {chunks.map((chunk, chunkIndex) => {
        const prev = chunkIndex > 0 ? chunks[chunkIndex - 1].settings : null;
        const isFirst = chunkIndex === 0;
        const showKey = isFirst || (prev && chunk.settings.key !== prev.key);
        const showTempo = isFirst || (prev && chunk.settings.tempo !== prev.tempo);
        const showTime =
          isFirst ||
          (prev &&
            (chunk.settings.timeSignature[0] !== prev.timeSignature[0] ||
              chunk.settings.timeSignature[1] !== prev.timeSignature[1]));

        return (
          <div key={chunk.startIndex} style={{ width: '100%' }}>
            <div
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                onSelectChunk(chunk.measures[0].id, { top: rect.bottom, left: rect.left });
              }}
              style={{
                background: 'var(--border)',
                border: '1px solid var(--border-light)',
                borderBottom: '1px solid var(--border)',
                borderRadius: '8px 8px 0 0',
                padding: '8px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                cursor: 'pointer',
                color: 'var(--text)',
                fontSize: '0.85rem',
                position: 'relative',
              }}
            >
              {/* この chunk 内の小節を選択中であることを示す */}
              {chunk.measures.some((m) => m.id === selectedSlot?.measureId) && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: -1,
                    height: '2px',
                    background: 'var(--accent)',
                  }}
                />
              )}
              {showKey && (
                <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>
                  Key= {getTheoreticalKeyDisplay(chunk.settings.key)}
                </span>
              )}
              {showTempo && (
                <span style={{ color: 'var(--accent-warm)' }}>♩={chunk.settings.tempo}</span>
              )}
              {showTime && (
                <span style={{ color: 'var(--text-dim)' }}>
                  {chunk.settings.timeSignature[0]}/{chunk.settings.timeSignature[1]}
                </span>
              )}
            </div>

            <div className={`chord-grid-chunk${isMobile ? ' mobile' : ''}`}>
              {chunk.measures.flatMap((measure, offset) => {
                const measureIndex = chunk.startIndex + offset;

                // 参照小節を展開表示している場合は参照先の小節を並べる
                const expanded =
                  measure.isReferenceExpanded && measure.referenceLabel
                    ? project.measures.filter((m) => m.label === measure.referenceLabel)
                    : null;
                const loops = measure.referenceLoopCount || 1;

                const entries = expanded
                  ? Array.from({ length: loops }).flatMap((_, loop) =>
                      expanded.map((src, i) => ({
                        rendered: src,
                        origin: measure,
                        measureIndex,
                        virtualId: `${measure.id}-loop-${loop}-${i}`,
                        isExpansionStart: loop > 0 && i === 0,
                      })),
                    )
                  : [
                      {
                        rendered: measure,
                        origin: measure,
                        measureIndex,
                        virtualId: measure.id,
                        isExpansionStart: false,
                      },
                    ];

                return entries.map((entry) => {
                  const { rendered, origin, virtualId, isExpansionStart } = entry;
                  const settings = chunk.settings;

                  // 未展開の参照小節は参照先のスロット構成を借りて表示する
                  const referenceSource =
                    origin.referenceLabel && !origin.isReferenceExpanded
                      ? project.measures.find((m) => m.label === origin.referenceLabel)
                      : null;
                  const slots = referenceSource ? referenceSource.slots : rendered.slots;
                  const isReferenceOverlay = !!referenceSource;

                  const slotWidth = contentWidth / (isMobile ? 1 : 2) / slots.length;

                  const showLabelBadge =
                    !!rendered.label &&
                    (entry.measureIndex === 0 ||
                      project.measures[entry.measureIndex - 1]?.label !== rendered.label);

                  // メロディー面。拍どおりの等分マスに、音を帯で重ねる
                  if (editMode === 'melody') {
                    const source = referenceSource ?? rendered;
                    // 参照小節は借りてきた表示なので、前の小節からの流れ込みは持たせない
                    const sourceIndex = referenceSource
                      ? project.measures.indexOf(referenceSource)
                      : entry.measureIndex;
                    const rowSegments = referenceSource
                      ? (segments[sourceIndex] ?? []).filter((seg) => seg.isStart)
                      : (segments[entry.measureIndex] ?? []);
                    return (
                      <div className="measure-box" key={virtualId}>
                        <MelodyRow
                          segments={rowSegments}
                          chordLabels={source.slots.map((slot) => ({
                            name: nameOf(slot.chordId, settings.key),
                            duration: slot.duration,
                          }))}
                          measureId={origin.id}
                          measureKey={settings.key}
                          useDegreeNotation={useDegreeNotation}
                          cells={settings.timeSignature[0]}
                          measureBeats={measureLength(settings.timeSignature)}
                          measureWidth={contentWidth / (isMobile ? 1 : 2)}
                          range={melodyBounds}
                          cursor={
                            melodyCursor?.measureId === origin.id ? melodyCursor.start : null
                          }
                          playingNote={
                            playingSlot?.melodyIndex != null &&
                            playingSlot.melodyOwnerIndex != null
                              ? {
                                  ownerIndex: playingSlot.melodyOwnerIndex,
                                  noteIndex: playingSlot.melodyIndex,
                                }
                              : null
                          }
                          selectedNote={referenceSource ? null : selectedMelodyNote}
                          inSelection={(cellIndex) =>
                            isInSelection(
                              entry.measureIndex,
                              cellIndex,
                              project.measures,
                              selectedSlot,
                              selectionEnd,
                            )
                          }
                          onSelect={(cellIndex, shiftKey) =>
                            onSelectSlot(origin.id, cellIndex, shiftKey)
                          }
                        />
                      </div>
                    );
                  }

                  return (
                    <div className="measure-box" key={virtualId}>
                      <div
                        style={{
                          display: 'flex',
                          flex: 1,
                          minWidth: 0,
                          position: 'relative',
                          overflow: 'visible',
                        }}
                      >
                        {rendered.label && (
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              bottom: 0,
                              width: '4px',
                              background: 'var(--accent)',
                              zIndex: 2,
                            }}
                          />
                        )}

                        {showLabelBadge && !isReferenceOverlay && (
                          <div
                            style={{
                              position: 'absolute',
                              top: -18,
                              left: 0,
                              background: 'var(--accent)',
                              color: 'var(--bg)',
                              fontSize: '0.65rem',
                              padding: '1px 6px',
                              fontWeight: 'bold',
                              zIndex: 25,
                              borderRadius: '3px 3px 0 0',
                              pointerEvents: 'none',
                            }}
                          >
                            {rendered.label}
                          </div>
                        )}

                        {isExpansionStart && (
                          <div
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleExpansion(origin.id);
                            }}
                            style={{
                              position: 'absolute',
                              top: -12,
                              left: 0,
                              background: 'var(--border)',
                              color: 'var(--accent)',
                              fontSize: '0.6rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid var(--accent)',
                              zIndex: 30,
                              cursor: 'pointer',
                              fontWeight: 'bold',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            展開中 (タップで閉じる)
                          </div>
                        )}

                        {slots.map((slot, slotIndex) => {
                          const chordId = isReferenceOverlay
                            ? (origin.slots[slotIndex]?.chordId ?? null)
                            : slot.chordId;
                          const chordName = nameOf(chordId, settings.key);

                          // 後続の空スロットぶんまで表示幅を確保する
                          let extra = 0;
                          if (chordName) {
                            for (let i = slotIndex + 1; i < slots.length; i++) {
                              if (nameOf(slots[i].chordId, settings.key)) break;
                              extra++;
                            }
                          }

                          return (
                            <SlotView
                              key={slotIndex}
                              slot={slot}
                              measure={origin}
                              slotIndex={slotIndex}
                              chordName={chordName}
                              displaySlots={1 + extra}
                              slotWidth={slotWidth}
                              isMobile={isMobile}
                              isSelected={
                                selectedSlot?.measureId === origin.id &&
                                selectedSlot?.slotIndex === slotIndex
                              }
                              isPlaying={
                                playingSlot?.measureIndex === entry.measureIndex &&
                                playingSlot?.slotIndex === slotIndex
                              }
                              inSelection={isInSelection(
                                entry.measureIndex,
                                slotIndex,
                                project.measures,
                                selectedSlot,
                                selectionEnd,
                              )}
                              isReferenceOverlay={isReferenceOverlay}
                              referenceLabelText={
                                origin.referenceLabel
                                  ? `※ ${origin.referenceLabel}${loops > 1 ? ` × ${loops}` : ''}`
                                  : null
                              }
                              loopProgress={
                                playingSlot?.measureIndex === entry.measureIndex &&
                                playingSlot.loopInfo
                                  ? `${playingSlot.loopInfo.current}/${playingSlot.loopInfo.total}`
                                  : null
                              }
                              onSelect={(e) => onSelectSlot(origin.id, slotIndex, e.shiftKey)}
                              onToggleExpansion={() => onToggleExpansion(origin.id)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                });
              })}
            </div>
          </div>
        );
      })}

      {hasExpanded && (
        <div
          style={{
            width: '100%',
            marginTop: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--accent)',
            fontSize: '0.75rem',
          }}
        >
          <span style={{ fontSize: '0.6rem' }}>●</span>
          参照セクションを展開表示中
        </div>
      )}
    </div>
  );
}
