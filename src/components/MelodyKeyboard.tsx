import { getNoteName, getScaleDegree, pitchForDegree, rootOffset } from '../lib/musicTheory';
import type { MelodySlot } from '../types';

/** 度数ボタンに出す音名を求めるための基準オクターブ（C4 まわり） */
const REFERENCE_PITCH = 60;

interface Props {
  selected: MelodySlot | null;
  /** 直前に置いた音。次の音をこの近くに置く */
  previousPitch: number | null;
  projectKey: string;
  isSlotSelected: boolean;
  onInput: (patch: MelodySlot) => void;
  onShift: (semitones: number) => void;
}

const cellStyle: React.CSSProperties = { padding: '15px 4px', height: 'auto' };

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '8px',
};

export default function MelodyKeyboard({
  selected,
  previousPitch,
  projectKey,
  isSlotSelected,
  onInput,
  onShift,
}: Props) {
  if (!isSlotSelected) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100px',
          color: 'var(--text-dim)',
          border: '1px dashed var(--border)',
          borderRadius: '8px',
          margin: '10px',
        }}
      >
        拍を選択してください
      </div>
    );
  }

  const pitch = selected?.pitch ?? null;
  // 次の音を置く高さの基準。直前の音があればその近くに置く
  const anchor = pitch ?? previousPitch ?? rootOffset(projectKey) + REFERENCE_PITCH;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', userSelect: 'none' }}>
      {/* いま選んでいる音 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '15px',
          background: 'var(--panel)',
          padding: '10px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <button className="step-btn" title="半音下げる" onClick={() => onShift(-1)}>
          ♭
        </button>
        <span
          style={{
            fontSize: '1.5rem',
            fontWeight: 'bold',
            color: pitch === null ? 'var(--text-muted)' : '#f472b6',
            minWidth: '90px',
            textAlign: 'center',
          }}
        >
          {pitch === null ? '休符' : `${getScaleDegree(pitch, projectKey)} (${getNoteName(pitch)})`}
        </span>
        <button className="step-btn" title="半音上げる" onClick={() => onShift(1)}>
          ♯
        </button>
        <span style={{ borderLeft: '1px solid var(--border-light)', paddingLeft: '15px', display: 'flex', gap: '8px' }}>
          <button className="step-btn" title="1オクターブ下げる" onClick={() => onShift(-12)}>
            ▼
          </button>
          <button className="step-btn" title="1オクターブ上げる" onClick={() => onShift(12)}>
            ▲
          </button>
        </span>
      </div>

      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* 度数パッド。押すと直前の音にいちばん近い高さで入る */}
        <div style={gridStyle}>
          {[1, 2, 3, 4, 5, 6, 7].map((degree) => {
            const target = pitchForDegree(degree, projectKey, anchor);
            const isCurrent = pitch !== null && ((pitch - target) % 12 === 0);
            return (
              <button
                key={degree}
                className={`key-btn ${isCurrent ? 'selected' : ''}`}
                style={cellStyle}
                onClick={() => onInput({ pitch: target, duration: 0 })}
              >
                <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{degree}</span>
                <span
                  style={{
                    display: 'block',
                    fontSize: '0.65rem',
                    color: isCurrent ? 'var(--bg)' : 'var(--text-dim)',
                  }}
                >
                  {getNoteName(target).replace(/[0-9]/g, '')}
                </span>
              </button>
            );
          })}
          <button
            className={`key-btn ${pitch === null && !selected?.tie ? 'selected' : ''}`}
            style={cellStyle}
            onClick={() => onInput({ pitch: null, duration: 0 })}
          >
            休符
          </button>
        </div>

        <div style={gridStyle}>
          <button
            className={`key-btn ${selected?.tie ? 'selected' : ''}`}
            style={{ ...cellStyle, gridColumn: 'span 2' }}
            onClick={() => onInput({ pitch, duration: 0, tie: !selected?.tie })}
            title="直前の音を伸ばす"
          >
            タイ（伸ばす）
          </button>
        </div>
      </div>
    </div>
  );
}
