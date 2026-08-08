import { useMemo } from 'react';
import type { Chord, EffectiveSettings, Measure, Project, Slot, SlotRef } from '../types';
import { buildChunks } from '../lib/measures';
import { getChordName, getDegreeName, getTheoreticalKeyDisplay } from '../lib/musicTheory';

const DESKTOP_CONTENT_WIDTH = 968;
const BASE_FONT_DESKTOP = 1.1;
const BASE_FONT_MOBILE = 0.95;
/** 文字幅の見積もり係数（1文字 ≒ fontSize * 16 * この値） */
const CHAR_WIDTH_RATIO = 0.5;

interface FontResult {
  fontSize: number;
  needsExpansion: boolean;
}

/** コード名がスロットに収まるフォントサイズを求める */
function fitChordName(
  name: string,
  slotWidth: number,
  displaySlots: number,
  isMobile: boolean,
): FontResult {
  const margin = isMobile ? 50 : 100;
  const base = isMobile ? BASE_FONT_MOBILE : BASE_FONT_DESKTOP;
  const available = displaySlots * slotWidth - 4;
  const estimated = name.length * base * 16 * CHAR_WIDTH_RATIO;

  let fontSize = base;
  if (estimated > available) fontSize = available / (name.length * 16 * CHAR_WIDTH_RATIO);
  fontSize = Math.max(0.5, fontSize);

  const needsExpansion = name.length * fontSize * 16 * CHAR_WIDTH_RATIO > slotWidth - margin;
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

interface Props {
  project: Project;
  selectedSlot: SlotRef | null;
  selectionEnd: SlotRef | null;
  playingSlot: { measureIndex: number; slotIndex: number } | null;
  useDegreeNotation: boolean;
  resolveSettings: (index: number) => EffectiveSettings;
  onSelectSlot: (measureId: string, slotIndex: number, shiftKey: boolean) => void;
  onSelectChunk: (measureId: string, anchor: { top: number; left: number }) => void;
  onToggleExpansion: (measureId: string) => void;
  isMobile: boolean;
}

export default function ChordGrid({
  project,
  selectedSlot,
  selectionEnd,
  playingSlot,
  useDegreeNotation,
  resolveSettings,
  onSelectSlot,
  onSelectChunk,
  onToggleExpansion,
  isMobile,
}: Props) {
  const chunks = useMemo(
    () => buildChunks(project.measures, resolveSettings),
    [project.measures, resolveSettings],
  );

  const contentWidth = isMobile ? window.innerWidth - 32 : DESKTOP_CONTENT_WIDTH;
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
