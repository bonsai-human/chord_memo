import { useState } from 'react';
import { getNoteName, getScaleDegree, pitchForDegree, rootOffset } from '../lib/musicTheory';
import type { MelodyNote } from '../types';

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
  /** カーソル上の音。無ければ null（＝そこは無音） */
  selected: MelodyNote | null;
  /** 直前に置いた音。次の音をこの近くに置く */
  previousPitch: number | null;
  projectKey: string;
  /** キーに対する相対表記（移動ド）にするか。グリッドの表記と揃える */
  useDegreeNotation: boolean;
  isSlotSelected: boolean;
  /** いま選んでいる音価と修飾 */
  noteValue: number;
  dotted: boolean;
  triplet: boolean;
  onChangeValue: (value: number, dotted: boolean, triplet: boolean) => void;
  /** 音価の梯子を1段動かす。連打を取りこぼさないよう計算は呼び出し側に置く */
  onStepValue: (delta: -1 | 1) => void;
  /** マスの移動。細かい位置はタップで狙わせずボタンで詰める */
  onMoveCursor: (delta: -1 | 1) => void;
  onInput: (pitch: number) => void;
  onShift: (semitones: number) => void;
}

/** タッチの当たり判定。44px はタッチターゲットの一般的な下限 */
const TAP_SIZE = 44;

const controlStyle: React.CSSProperties = {
  height: `${TAP_SIZE}px`,
  padding: '0 8px',
  fontSize: '0.78rem',
  minWidth: `${TAP_SIZE}px`,
};

/** ♭♯▼▲ や ◀▶ のような記号ボタン */
const stepStyle: React.CSSProperties = {
  width: `${TAP_SIZE}px`,
  height: `${TAP_SIZE}px`,
  fontSize: '1.05rem',
};

/** グループの区切り。左右の gap と合わせて 20px ぶん離す */
const dividerStyle: React.CSSProperties = {
  width: '1px',
  alignSelf: 'stretch',
  background: 'var(--border)',
  margin: '4px 0',
};

export default function MelodyKeyboard({
  selected,
  previousPitch,
  projectKey,
  useDegreeNotation,
  isSlotSelected,
  noteValue,
  dotted,
  triplet,
  onChangeValue,
  onStepValue,
  onMoveCursor,
  onInput,
  onShift,
}: Props) {
  const [paletteRect, setPaletteRect] = useState<DOMRect | null>(null);

  if (!isSlotSelected) {
    return (
      <div className="keyboard-placeholder">音を置く位置を選んでください</div>
    );
  }

  const pitch = selected?.pitch ?? null;
  const anchor = pitch ?? previousPitch ?? rootOffset(projectKey) + REFERENCE_PITCH;

  const ladderIndex = NOTE_VALUES.findIndex((v) => Math.abs(v.value - noteValue) < 0.001);

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
          gap: '12px',
          background: 'var(--panel)',
          padding: '8px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <button
          className="step-btn"
          style={stepStyle}
          title="前のマスへ"
          onClick={() => onMoveCursor(-1)}
        >
          ◀
        </button>
        <button
          className="step-btn"
          style={stepStyle}
          title="次のマスへ"
          onClick={() => onMoveCursor(1)}
        >
          ▶
        </button>

        <span style={dividerStyle} />

        <button
          className="step-btn"
          title="音価を短くする"
          disabled={ladderIndex >= NOTE_VALUES.length - 1}
          style={{ ...stepStyle, ...shiftStyle(ladderIndex < NOTE_VALUES.length - 1) }}
          onClick={() => onStepValue(1)}
        >
          −
        </button>
        <button
          className="key-btn"
          style={{ ...controlStyle, minWidth: '62px' }}
          title="タップで音価の一覧"
          onClick={(e) => setPaletteRect(e.currentTarget.getBoundingClientRect())}
        >
          {noteValueLabel(noteValue, dotted, triplet)}
        </button>
        <button
          className="step-btn"
          title="音価を長くする"
          disabled={ladderIndex <= 0}
          style={{ ...stepStyle, ...shiftStyle(ladderIndex > 0) }}
          onClick={() => onStepValue(-1)}
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
      </div>

      {/* 2段目: いま選んでいる音と、半音・オクターブの微調整 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          padding: '10px 10px 0',
        }}
      >
        <button
          className="step-btn"
          title="1オクターブ下げる"
          disabled={!canShift}
          style={{ ...stepStyle, ...shiftStyle(canShift) }}
          onClick={() => onShift(-12)}
        >
          ▼
        </button>
        <button
          className="step-btn"
          title="半音下げる"
          disabled={!canShift}
          style={{ ...stepStyle, ...shiftStyle(canShift) }}
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
            // 半音ボタンと隣り合うので、誤タップしないよう左右を空ける
            margin: '0 12px',
          }}
        >
          {/* 度数はすぐ下の 1〜7 ボタンにも出ているので、ここは片方だけ */}
          {pitch === null
            ? '—'
            : useDegreeNotation
              ? getScaleDegree(pitch, projectKey)
              : getNoteName(pitch, projectKey)}
        </span>
        <button
          className="step-btn"
          title="半音上げる"
          disabled={!canShift}
          style={{ ...stepStyle, ...shiftStyle(canShift) }}
          onClick={() => onShift(1)}
        >
          ♯
        </button>
        <button
          className="step-btn"
          title="1オクターブ上げる"
          disabled={!canShift}
          style={{ ...stepStyle, ...shiftStyle(canShift) }}
          onClick={() => onShift(12)}
        >
          ▲
        </button>
      </div>

      {/*
        3段目: 度数。押すと anchor に最も近い高さで入り、次のマスへ進む。
        跳躍で意図と逆のオクターブに入ったときは ▼▲ で直す。
      */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: '6px',
          padding: '8px 10px',
        }}
      >
        {[1, 2, 3, 4, 5, 6, 7].map((degree) => {
          const target = pitchForDegree(degree, projectKey, anchor);
          const isCurrent = pitch === target;
          return (
            <button
              key={degree}
              className={`key-btn ${isCurrent ? 'selected' : ''}`}
              style={{
                padding: '10px 2px',
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                gap: '3px',
              }}
              onClick={() => onInput(target)}
            >
              {/*
                表記はグリッドと揃える。絶対表記のときはオクターブまで出す
                ので、▼▲ が要るかを押す前に判断できる
              */}
              <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>
                {useDegreeNotation ? degree : getNoteName(target, projectKey)}
              </span>
            </button>
          );
        })}
      </div>

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
