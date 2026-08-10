import { getNoteName, getScaleDegree, pitchForDegree, rootOffset } from '../lib/musicTheory';
import type { MelodySlot } from '../types';

/** 音価の候補（4分音符 = 1） */
export const NOTE_VALUES: { label: string; value: number }[] = [
  { label: '全', value: 4 },
  { label: '2分', value: 2 },
  { label: '4分', value: 1 },
  { label: '8分', value: 0.5 },
  { label: '16分', value: 0.25 },
];

/** 前の音が無いときに置く高さ（C4 まわり） */
const REFERENCE_PITCH = 60;

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
  onChangeValue: (value: number) => void;
  onToggleDotted: () => void;
  onToggleTriplet: () => void;
  onInput: (pitch: number | null) => void;
  onTie: () => void;
  onShift: (semitones: number) => void;
}

const controlStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '0.75rem',
  minWidth: '38px',
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
  onToggleDotted,
  onToggleTriplet,
  onInput,
  onTie,
  onShift,
}: Props) {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {/* 1段目: 音価と修飾、いま選んでいる音、休符とタイ */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px',
          background: 'var(--panel)',
          padding: '8px 10px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        {NOTE_VALUES.map((entry) => (
          <button
            key={entry.label}
            className={`key-btn ${noteValue === entry.value ? 'selected' : ''}`}
            style={controlStyle}
            onClick={() => onChangeValue(entry.value)}
            title={`${entry.label}音符`}
          >
            {entry.label}
          </button>
        ))}
        <button
          className={`key-btn ${dotted ? 'selected' : ''}`}
          style={controlStyle}
          onClick={onToggleDotted}
          title="付点（1.5倍）"
        >
          付点
        </button>
        <button
          className={`key-btn ${triplet ? 'selected' : ''}`}
          style={controlStyle}
          onClick={onToggleTriplet}
          title="3連符"
        >
          3連
        </button>

        <span style={{ width: '10px' }} />

        <button className="step-btn" title="半音下げる" onClick={() => onShift(-1)}>
          ♭
        </button>
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 'bold',
            color: pitch === null ? 'var(--text-muted)' : '#f472b6',
            minWidth: '76px',
            textAlign: 'center',
          }}
        >
          {pitch === null ? '休符' : `${getScaleDegree(pitch, projectKey)} ${getNoteName(pitch)}`}
        </span>
        <button className="step-btn" title="半音上げる" onClick={() => onShift(1)}>
          ♯
        </button>
        <button className="step-btn" title="1オクターブ下げる" onClick={() => onShift(-12)}>
          ▼
        </button>
        <button className="step-btn" title="1オクターブ上げる" onClick={() => onShift(12)}>
          ▲
        </button>

        <span style={{ width: '10px' }} />

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

      {/* 2段目: 度数。押すと直前の音に近い高さで入り、次へ進む */}
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
          const isCurrent = pitch !== null && (pitch - target) % 12 === 0;
          return (
            <button
              key={degree}
              className={`key-btn ${isCurrent ? 'selected' : ''}`}
              style={{ padding: '10px 2px', display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: '4px' }}
              onClick={() => onInput(target)}
            >
              <span style={{ fontSize: '1.05rem', fontWeight: 'bold' }}>{degree}</span>
              <span
                style={{ fontSize: '0.65rem', color: isCurrent ? 'var(--bg)' : 'var(--text-dim)' }}
              >
                {getNoteName(target).replace(/[0-9]/g, '')}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
