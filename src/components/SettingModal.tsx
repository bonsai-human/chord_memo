import { useState } from 'react';
import type { Measure, Project, SwingResolution } from '../types';
import { RELATIVE_MINOR, rootOffset } from '../lib/musicTheory';
import Modal from './Modal';

export type SettingType = 'key' | 'tempo' | 'timeSignature' | 'swing' | 'reference' | 'label';

const TITLES: Record<SettingType, string> = {
  key: 'キー設定',
  tempo: 'テンポ設定',
  timeSignature: '拍子設定',
  swing: 'スウィング率',
  reference: '同期参照',
  label: 'セクションラベル',
};

const MAJOR_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEYS = MAJOR_KEYS.map((k) => RELATIVE_MINOR[k]);

/** タップテンポで平均を取る間隔の数。増やすほど安定するが追従が鈍る */
const TAP_SAMPLES = 4;
/** これだけ間が空いたら数え直し */
const TAP_RESET_MS = 2000;
const TEMPO_MIN = 40;
const TEMPO_MAX = 300;

interface Props {
  type: SettingType;
  project: Project;
  measure: Measure;
  measureIndex: number;
  onApply: (patch: Partial<Measure>) => void;
  onRemove: () => void;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--bg-grid)',
  color: 'white',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '10px',
  outline: 'none',
};

export default function SettingModal({
  type,
  project,
  measure,
  measureIndex,
  onApply,
  onRemove,
  onClose,
}: Props) {
  const [keyMode, setKeyMode] = useState<'major' | 'minor'>(
    (measure.key || project.key).endsWith('m') ? 'minor' : 'major',
  );
  const [keyValue, setKeyValue] = useState(measure.key || project.key);
  const [tempo, setTempo] = useState(String(measure.tempo || project.tempo));
  const [timeSignature, setTimeSignature] = useState<[string, number]>([
    String((measure.timeSignature || project.timeSignature)[0]),
    (measure.timeSignature || project.timeSignature)[1],
  ]);
  const [swing, setSwing] = useState(measure.swing ?? 0.5);
  const [swingResolution, setSwingResolution] = useState<SwingResolution>(
    measure.swingResolution || project.swingResolution || '8n',
  );
  const [referenceLabel, setReferenceLabel] = useState(measure.referenceLabel || '');
  const [loopCount, setLoopCount] = useState(String(measure.referenceLoopCount || 1));
  const [label, setLabel] = useState(measure.label || '');
  /** タップテンポで押した時刻。間が空いたら捨てる */
  const [taps, setTaps] = useState<number[]>([]);

  /**
   * タップでテンポを測る。直近 TAP_SAMPLES 個の間隔の平均から求める。
   * 入力欄を書き換えるだけなので、気に入らなければ「キャンセル」で捨てられる
   */
  const tapTempo = () => {
    const now = performance.now();
    const recent = taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS ? [] : taps;
    const next = [...recent, now].slice(-(TAP_SAMPLES + 1));
    setTaps(next);
    if (next.length < 2) return;

    const span = next[next.length - 1] - next[0];
    const average = span / (next.length - 1);
    const bpm = Math.round(60000 / average);
    setTempo(String(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, bpm))));
  };

  const availableLabels = Array.from(
    new Set(project.measures.map((m) => m.label).filter((l): l is string => !!l && l !== measure.label)),
  );

  const apply = () => {
    switch (type) {
      case 'key':
        onApply({ key: keyValue });
        break;
      case 'tempo': {
        const value = parseInt(tempo, 10);
        if (!Number.isNaN(value) && value > 0) onApply({ tempo: value });
        break;
      }
      case 'timeSignature': {
        const numerator = parseInt(timeSignature[0], 10);
        if (!Number.isNaN(numerator) && numerator > 0) {
          onApply({ timeSignature: [numerator, timeSignature[1]] });
        }
        break;
      }
      case 'swing':
        onApply({ swing, swingResolution });
        break;
      case 'reference':
        onApply({
          referenceLabel: referenceLabel || undefined,
          referenceLoopCount: Math.max(1, parseInt(loopCount, 10) || 1),
        });
        break;
      case 'label':
        onApply({ label: label.trim() || undefined });
        break;
    }
    onClose();
  };

  // 先頭小節の key / tempo / 拍子は曲全体の初期値なので消せない
  const removable = !(measureIndex === 0 && ['key', 'tempo', 'timeSignature'].includes(type));

  const switchKeyMode = (mode: 'major' | 'minor') => {
    if (mode === keyMode) return;
    setKeyMode(mode);
    const pitch = rootOffset(keyValue);
    const table = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;
    setKeyValue(table.find((k) => rootOffset(k) === pitch) || table[0]);
  };

  return (
    <Modal title={TITLES[type]} width={380} onClose={onClose}>
      {type === 'key' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div
            style={{
              display: 'flex',
              gap: '4px',
              background: 'var(--bg-grid)',
              borderRadius: '6px',
              padding: '4px',
            }}
          >
            {(['major', 'minor'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => switchKeyMode(mode)}
                style={{
                  flex: 1,
                  background: keyMode === mode ? 'var(--border)' : 'transparent',
                  color: keyMode === mode ? 'white' : 'var(--text-dim)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '8px',
                  cursor: 'pointer',
                  fontWeight: keyMode === mode ? 'bold' : 'normal',
                }}
              >
                {mode === 'major' ? 'メジャー' : 'マイナー'}
              </button>
            ))}
          </div>
          <select
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            style={inputStyle}
          >
            {(keyMode === 'major' ? MAJOR_KEYS : MINOR_KEYS).map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === 'tempo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
            <input
              type="text"
              inputMode="numeric"
              value={tempo}
              autoFocus
              onChange={(e) => {
                setTempo(e.target.value);
                setTaps([]);
              }}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={tapTempo}
              style={{
                width: '96px',
                background: taps.length > 0 ? 'var(--accent)' : 'var(--border)',
                color: taps.length > 0 ? 'var(--bg)' : 'white',
                border: 'none',
                borderRadius: '4px',
                fontWeight: 'bold',
                cursor: 'pointer',
                // 連打するボタンなので、長押しの選択や拡大鏡が出ないようにする
                touchAction: 'manipulation',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              タップ
            </button>
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
            {taps.length < 2
              ? '「タップ」を拍に合わせて4回ほど叩くとテンポを測ります'
              : `${taps.length - 1} 回ぶんの間隔から算出（2秒あけると測り直し）`}
          </span>
        </div>
      )}

      {type === 'timeSignature' && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            inputMode="numeric"
            value={timeSignature[0]}
            onChange={(e) => setTimeSignature([e.target.value, timeSignature[1]])}
            style={{ ...inputStyle, width: '60px', textAlign: 'center' }}
          />
          <span style={{ color: 'var(--text-dim)' }}>/</span>
          <select
            value={timeSignature[1]}
            onChange={(e) => setTimeSignature([timeSignature[0], parseInt(e.target.value, 10)])}
            style={{ ...inputStyle, flex: 1 }}
          >
            {[2, 4, 8, 16].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {type === 'swing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label
              style={{
                display: 'block',
                color: 'var(--text-dim)',
                fontSize: '0.75rem',
                marginBottom: '8px',
              }}
            >
              解像度:
            </label>
            <div
              style={{
                display: 'flex',
                gap: '4px',
                background: 'var(--bg-grid)',
                borderRadius: '6px',
                padding: '4px',
              }}
            >
              {(['8n', '16n'] as SwingResolution[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setSwingResolution(r)}
                  style={{
                    flex: 1,
                    background: swingResolution === r ? 'var(--border)' : 'transparent',
                    color: swingResolution === r ? 'white' : 'var(--text-dim)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px',
                    cursor: 'pointer',
                  }}
                >
                  {r === '8n' ? '8分' : '16分'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                color: 'var(--text-dim)',
                fontSize: '0.75rem',
                marginBottom: '8px',
              }}
            >
              スウィング率: {Math.round(swing * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={swing}
              onChange={(e) => setSwing(parseFloat(e.target.value))}
            />
          </div>
        </div>
      )}

      {type === 'reference' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label
              style={{
                display: 'block',
                color: 'var(--text-dim)',
                fontSize: '0.75rem',
                marginBottom: '5px',
              }}
            >
              参照先セクション:
            </label>
            <select
              value={referenceLabel}
              onChange={(e) => setReferenceLabel(e.target.value)}
              style={inputStyle}
            >
              <option value="">-</option>
              {availableLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              style={{
                display: 'block',
                color: 'var(--text-dim)',
                fontSize: '0.75rem',
                marginBottom: '5px',
              }}
            >
              ループ回数:
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={loopCount}
              onChange={(e) => setLoopCount(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      )}

      {type === 'label' && (
        <input
          type="text"
          placeholder="セクション名 (例: Aメロ)"
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            padding: '10px',
            background: 'var(--border)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          キャンセル
        </button>
        <button
          onClick={apply}
          style={{
            flex: 1,
            padding: '10px',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          適用
        </button>
      </div>

      {removable && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px' }}>
          <button
            onClick={() => {
              onRemove();
              onClose();
            }}
            style={{
              color: 'var(--danger)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.8rem',
            }}
          >
            設定を削除
          </button>
        </div>
      )}
    </Modal>
  );
}
