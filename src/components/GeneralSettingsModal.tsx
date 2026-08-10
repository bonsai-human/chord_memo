import { Settings } from 'lucide-react';
import type { InstrumentId, Project } from '../types';
import { getNoteName } from '../lib/musicTheory';
import { MAX_MELODY_VOLUME } from '../lib/storage';
import Modal from './Modal';

const INSTRUMENTS: { id: InstrumentId; name: string }[] = [
  { id: 'piano', name: 'Piano' },
  { id: 'guitar-acoustic', name: 'Acoustic Guitar' },
  { id: 'organ', name: 'Organ' },
  { id: 'guitar-electric', name: 'Distortion Guitar' },
  { id: 'violin', name: 'Violin' },
  { id: 'synth-lead', name: 'Synth Lead' },
];

const VOICING_MIN = 24;
const VOICING_MAX = 96;

interface Props {
  project: Project;
  useDegreeNotation: boolean;
  onChangeDegreeNotation: (value: boolean) => void;
  onUpdate: (patch: Partial<Project>) => void;
  onTranspose: (semitones: number) => void;
  onClose: () => void;
}

interface ToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function ToggleCard({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label
      style={{
        background: 'var(--bg-grid)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{label}</span>
      </span>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>{description}</span>
    </label>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
};

export default function GeneralSettingsModal({
  project,
  useDegreeNotation,
  onChangeDegreeNotation,
  onUpdate,
  onTranspose,
  onClose,
}: Props) {
  return (
    <Modal
      title="全般設定"
      icon={<Settings size={18} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <div style={{ padding: '15px', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--accent)',
              color: 'var(--bg)',
              border: 'none',
              borderRadius: '6px',
              padding: '10px 20px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            設定を完了
          </button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
        <ToggleCard
          label="ループ"
          description="最後まで自動ループ"
          checked={project.loopEnabled}
          onChange={(v) => onUpdate({ loopEnabled: v })}
        />
        <ToggleCard
          label="メトロノーム"
          description="クリック音を鳴らす"
          checked={project.metronomeEnabled}
          onChange={(v) => onUpdate({ metronomeEnabled: v })}
        />
        <ToggleCard
          label="ボイシング"
          description="音域を自動調整"
          checked={project.voicingOptimize}
          onChange={(v) => onUpdate({ voicingOptimize: v })}
        />
        <ToggleCard
          label="度数表記"
          description="I, IV, V... で表示"
          checked={useDegreeNotation}
          onChange={onChangeDegreeNotation}
        />
      </div>

      <div
        style={{
          marginTop: '20px',
          background: 'var(--bg-grid)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '15px',
        }}
      >
        <div style={rowStyle}>
          <span style={{ fontSize: '0.85rem' }}>音色</span>
          <select
            value={project.instrument}
            onChange={(e) => onUpdate({ instrument: e.target.value as InstrumentId })}
            style={{
              background: 'var(--panel)',
              color: 'white',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '6px 10px',
            }}
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: '15px' }}>
          <div style={rowStyle}>
            <span style={{ fontSize: '0.85rem' }}>音量</span>
            <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>
              {project.masterVolume}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={project.masterVolume}
            onChange={(e) => onUpdate({ masterVolume: parseInt(e.target.value, 10) })}
          />
        </div>

        <div style={{ ...rowStyle, marginTop: '15px' }}>
          <span style={{ fontSize: '0.85rem' }}>メロディーの音色</span>
          <select
            value={project.melodyInstrument}
            onChange={(e) => onUpdate({ melodyInstrument: e.target.value as InstrumentId })}
            style={{
              background: 'var(--panel)',
              color: 'white',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              padding: '6px 10px',
            }}
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: '15px' }}>
          <div style={rowStyle}>
            <span style={{ fontSize: '0.85rem' }}>メロディーの音量</span>
            <span style={{ color: '#f472b6', fontSize: '0.85rem' }}>{project.melodyVolume}%</span>
          </div>
          <input
            type="range"
            min="0"
            max={MAX_MELODY_VOLUME}
            value={project.melodyVolume}
            onChange={(e) => onUpdate({ melodyVolume: parseInt(e.target.value, 10) })}
            style={{ accentColor: '#f472b6' }}
          />
        </div>

        <div style={{ ...rowStyle, marginTop: '15px' }}>
          <span style={{ fontSize: '0.85rem' }}>
            曲全体を移調
            <span style={{ display: 'block', color: 'var(--text-dim)', fontSize: '0.7rem' }}>
              キー指定とコードをまとめて動かします
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="step-btn" title="半音下げる" onClick={() => onTranspose(-1)}>
              ♭
            </button>
            <span
              style={{
                color: 'var(--accent)',
                fontWeight: 'bold',
                minWidth: '38px',
                textAlign: 'center',
              }}
            >
              {project.key}
            </span>
            <button className="step-btn" title="半音上げる" onClick={() => onTranspose(1)}>
              ♯
            </button>
          </span>
        </div>

        <div style={{ marginTop: '15px' }}>
          <div style={rowStyle}>
            <span style={{ fontSize: '0.85rem' }}>音域制限</span>
            <span style={{ color: 'var(--accent-warm)', fontSize: '0.85rem' }}>
              {getNoteName(project.voicingMin)} - {getNoteName(project.voicingMax)}
            </span>
          </div>
          <input
            type="range"
            min={VOICING_MIN}
            max={VOICING_MAX}
            value={project.voicingMax}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              onUpdate({ voicingMax: Math.max(value, project.voicingMin + 1) });
            }}
          />
          <input
            type="range"
            min={VOICING_MIN}
            max={VOICING_MAX}
            value={project.voicingMin}
            onChange={(e) => {
              const value = parseInt(e.target.value, 10);
              onUpdate({ voicingMin: Math.min(value, project.voicingMax - 1) });
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
