import { useState } from 'react';
import { getNoteName, getScaleDegree, pitchForDegree, rootOffset } from '../lib/musicTheory';
import type { MelodySlot } from '../types';

/** 音価の候補（4分音符 = 1）。長い順に並べる＝ステッパーの梯子でもある */
export const NOTE_VALUES: { label: string; value: number }[] = [
  { label: '全', value: 4 },
  { label: '2分', value: 2 },
  { label: '4分', value: 1 },
  { label: '8分', value: 0.5 },
  { label: '16分', value: 0.25 },
];

/** 前の音が無いときに置く高さ（C4 まわり） */
const REFERENCE_PITCH = 60;

/** 「4分」「付点8分」「16分3連」のような表示名 */
function noteValueLabel(value: number, dotted: boolean, triplet: boolean): string {
  const base = NOTE_VALUES.find((v) => Math.abs(v.value - value) < 0.001)?.label ?? `${value}`;
  return `${dotted ? '付点' : ''}${base}${triplet ? '3連' : ''}`;
}

/** 拍数の表示。3連は割り切れないので分数のまま出さず小数2桁に丸める */
function beatsLabel(value: number, dotted: boolean, triplet: boolean): string {
  const beats = value * (dotted ? 1.5 : 1) * (triplet ? 2 / 3 : 1);
  return `${Math.round(beats * 100) / 100}拍`;
}

/**
 * degree の音のうち anchor 以下で最も高いもの。
 * pitchForDegree は anchor に最も近い音を返すので、上に出ていたら
 * 1オクターブ下げれば「anchor 以下で最も高い」になる。
 */
function degreePitchBelow(degree: number, key: string, anchor: number): number {
  const nearest = pitchForDegree(degree, key, anchor);
  return nearest <= anchor ? nearest : nearest - 12;
}

interface PaletteProps {
  /** 開いた基準になるボタンの位置 */
  rect: DOMRect;
  value: number;
  dotted: boolean;
  triplet: boolean;
  onPick: (value: number, dotted: boolean, triplet: boolean) => void;
  onClose: () => void;
}

/**
 * 音価の全一覧。ステッパーで届く「普通」の列に加えて、
 * 使用頻度の低い付点・3連をまとめて置く逃げ道。
 */
function NoteValuePalette({ rect, value, dotted, triplet, onPick, onClose }: PaletteProps) {
  const columns: { label: string; dotted: boolean; triplet: boolean }[] = [
    { label: '普通', dotted: false, triplet: false },
    { label: '付点', dotted: true, triplet: false },
    { label: '3連', dotted: false, triplet: true },
  ];

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 3050 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          // キーボードは画面下なので上へ開く
          bottom: window.innerHeight - rect.top + 8,
          left: Math.max(8, Math.min(rect.left - 80, window.innerWidth - 240 - 8)),
          zIndex: 3100,
          width: '240px',
          background: 'var(--panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '8px',
          boxShadow: '0 15px 30px -10px rgba(0, 0, 0, 0.7)',
          padding: '8px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '4px',
        }}
      >
        {columns.map((column) => (
          <div
            key={column.label}
            style={{
              fontSize: '0.65rem',
              color: 'var(--text-dim)',
              textAlign: 'center',
              paddingBottom: '2px',
            }}
          >
            {column.label}
          </div>
        ))}
        {NOTE_VALUES.flatMap((entry) =>
          columns.map((column) => {
            const isCurrent =
              Math.abs(entry.value - value) < 0.001 &&
              dotted === column.dotted &&
              triplet === column.triplet;
            return (
              <button
                key={`${entry.label}-${column.label}`}
                className={`key-btn ${isCurrent ? 'selected' : ''}`}
                style={{ padding: '8px 2px', fontSize: '0.7rem' }}
                onClick={() => {
                  onPick(entry.value, column.dotted, column.triplet);
                  onClose();
                }}
                title={beatsLabel(entry.value, column.dotted, column.triplet)}
              >
                {noteValueLabel(entry.value, column.dotted, column.triplet)}
              </button>
            );
          }),
        )}
      </div>
    </>
  );
}

interface Props {
  selected: MelodySlot | null;
  /** 直前に置いた音。次の音をこの近くに置く */
  previousPitch: number | null;
  projectKey: string;
  isSlotSelected: boolean;
  /** いま選んでいる音価と修飾 */
  noteValue: number;
  dotted: boolean;
  triplet: boolean;
  onChangeValue: (value: number, dotted: boolean, triplet: boolean) => void;
  /** マスの移動。細かい位置はタップで狙わせずボタンで詰める */
  onMoveCursor: (delta: -1 | 1) => void;
  onInput: (pitch: number | null) => void;
  onTie: () => void;
  onShift: (semitones: number) => void;
}

const controlStyle: React.CSSProperties = {
  padding: '6px 5px',
  fontSize: '0.72rem',
  minWidth: '34px',
};

const dividerStyle: React.CSSProperties = {
  width: '1px',
  alignSelf: 'stretch',
  background: 'var(--border)',
  margin: '0 2px',
};

export default function MelodyKeyboard({
  selected,
  previousPitch,
  projectKey,
  isSlotSelected,
  noteValue,
  dotted,
  triplet,
  onChangeValue,
  onMoveCursor,
  onInput,
  onTie,
  onShift,
}: Props) {
  const [paletteRect, setPaletteRect] = useState<DOMRect | null>(null);

  if (!isSlotSelected) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '70px',
          color: 'var(--text-dim)',
          border: '1px dashed var(--border)',
          borderRadius: '8px',
          margin: '10px',
        }}
      >
        音を置く位置を選んでください
      </div>
    );
  }

  const pitch = selected?.pitch ?? null;
  const anchor = pitch ?? previousPitch ?? rootOffset(projectKey) + REFERENCE_PITCH;

  const ladderIndex = NOTE_VALUES.findIndex((v) => Math.abs(v.value - noteValue) < 0.001);
  /** 梯子を1段動かす。付点・3連は「モード」なので保ったまま */
  const stepValue = (delta: -1 | 1) => {
    const next = NOTE_VALUES[Math.min(NOTE_VALUES.length - 1, Math.max(0, ladderIndex + delta))];
    if (next) onChangeValue(next.value, dotted, triplet);
  };

  const canShift = pitch !== null;
  const shiftStyle = (enabled: boolean): React.CSSProperties =>
    enabled ? {} : { opacity: 0.35, cursor: 'default' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {/* 1段目: 位置と音価 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '4px',
          background: 'var(--panel)',
          padding: '8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button className="step-btn" title="前のマスへ" onClick={() => onMoveCursor(-1)}>
          ◀
        </button>
        <button className="step-btn" title="次のマスへ" onClick={() => onMoveCursor(1)}>
          ▶
        </button>

        <span style={dividerStyle} />

        <button
          className="step-btn"
          title="音価を短くする"
          disabled={ladderIndex >= NOTE_VALUES.length - 1}
          style={shiftStyle(ladderIndex < NOTE_VALUES.length - 1)}
          onClick={() => stepValue(1)}
        >
          −
        </button>
        <button
          className="key-btn"
          style={{ ...controlStyle, minWidth: '58px' }}
          title="タップで音価の一覧"
          onClick={(e) => setPaletteRect(e.currentTarget.getBoundingClientRect())}
        >
          {noteValueLabel(noteValue, dotted, triplet)}
        </button>
        <button
          className="step-btn"
          title="音価を長くする"
          disabled={ladderIndex <= 0}
          style={shiftStyle(ladderIndex > 0)}
          onClick={() => stepValue(-1)}
        >
          ＋
        </button>
        <button
          className={`key-btn ${dotted ? 'selected' : ''}`}
          style={controlStyle}
          onClick={() => onChangeValue(noteValue, !dotted, false)}
          title="付点（1.5倍）"
        >
          付点
        </button>

        <span style={dividerStyle} />

        <button className="key-btn" style={controlStyle} onClick={() => onInput(null)}>
          休符
        </button>
        <button
          className={`key-btn ${selected?.tie ? 'selected' : ''}`}
          style={controlStyle}
          onClick={onTie}
          title="直前の音を伸ばす"
        >
          タイ
        </button>
      </div>

      {/* 2段目: いま選んでいる音と、半音・オクターブの微調整 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          padding: '8px 10px 0',
        }}
      >
        <button
          className="step-btn"
          title="1オクターブ下げる"
          disabled={!canShift}
          style={shiftStyle(canShift)}
          onClick={() => onShift(-12)}
        >
          ▼
        </button>
        <button
          className="step-btn"
          title="半音下げる"
          disabled={!canShift}
          style={shiftStyle(canShift)}
          onClick={() => onShift(-1)}
        >
          ♭
        </button>
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 'bold',
            color: pitch === null ? 'var(--text-muted)' : '#f472b6',
            minWidth: '92px',
            textAlign: 'center',
          }}
        >
          {pitch === null ? '休符' : `${getScaleDegree(pitch, projectKey)} ${getNoteName(pitch)}`}
        </span>
        <button
          className="step-btn"
          title="半音上げる"
          disabled={!canShift}
          style={shiftStyle(canShift)}
          onClick={() => onShift(1)}
        >
          ♯
        </button>
        <button
          className="step-btn"
          title="1オクターブ上げる"
          disabled={!canShift}
          style={shiftStyle(canShift)}
          onClick={() => onShift(12)}
        >
          ▲
        </button>
      </div>

      {/*
        3・4段目: 度数。上下段はつねに1オクターブ差で、ペアが anchor を挟む。
        7個では ±1オクターブの候補を指しきれず、5度や6度の跳躍・同度の
        オクターブ跳躍が押せなかったので2段にしている。
        枠付きが「anchor に近い方」＝従来1段だったときに選ばれていた音。
      */}
      {[1, 0].map((octave) => (
        <div
          key={octave}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: '6px',
            padding: octave === 1 ? '8px 10px 3px' : '0 10px 8px',
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7].map((degree) => {
            const below = degreePitchBelow(degree, projectKey, anchor);
            const target = below + octave * 12;
            const isCurrent = pitch === target;
            // 近い方（同点なら下）が従来の挙動で選ばれていた音
            const isNearest =
              octave === 0
                ? Math.abs(below - anchor) <= Math.abs(below + 12 - anchor)
                : Math.abs(below + 12 - anchor) < Math.abs(below - anchor);
            return (
              <button
                key={degree}
                className={`key-btn ${isCurrent ? 'selected' : ''}`}
                style={{
                  padding: '8px 2px 10px',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'center',
                  gap: '3px',
                }}
                onClick={() => onInput(target)}
              >
                <span style={{ fontSize: '1rem', fontWeight: 'bold' }}>{degree}</span>
                <span
                  style={{
                    fontSize: '0.6rem',
                    color: isCurrent ? 'var(--bg)' : 'var(--text-dim)',
                  }}
                >
                  {getNoteName(target)}
                </span>
                {/* anchor に近い方＝順次進行で使う側の目印。14個から目で拾えるように */}
                {isNearest && (
                  <span
                    style={{
                      position: 'absolute',
                      bottom: '4px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: '40%',
                      height: '2px',
                      borderRadius: '1px',
                      background: isCurrent ? 'var(--bg)' : 'var(--accent)',
                      opacity: isCurrent ? 0.5 : 0.75,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}

      {paletteRect && (
        <NoteValuePalette
          rect={paletteRect}
          value={noteValue}
          dotted={dotted}
          triplet={triplet}
          onPick={onChangeValue}
          onClose={() => setPaletteRect(null)}
        />
      )}
    </div>
  );
}
