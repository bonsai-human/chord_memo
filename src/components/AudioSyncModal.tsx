import { useState } from 'react';
import { Music, Upload, Youtube } from 'lucide-react';
import type { Project } from '../types';
import Modal from './Modal';

type Tab = 'file' | 'youtube';

interface Props {
  project: Project;
  onUpdate: (patch: Partial<Project>) => void;
  onSelectFile: (file: File) => void;
  onClose: () => void;
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: '8px',
};

const boxStyle: React.CSSProperties = {
  background: 'var(--panel)',
  color: 'var(--accent-warm)',
  border: '1px solid var(--border)',
  borderRadius: '4px',
  padding: '6px',
  width: '50px',
  textAlign: 'center',
  fontSize: '0.9rem',
};

export default function AudioSyncModal({ project, onUpdate, onSelectFile, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(project.useYoutubeAudio ? 'youtube' : 'file');
  const [url, setUrl] = useState(project.youtubeUrl || '');

  const offset = project.audioOffset || 0;
  const whole = Math.floor(offset);
  const fraction = Math.round((offset - whole) * 100);

  const setOffset = (nextWhole: number, nextFraction: number) => {
    const value = Math.max(0, nextWhole) + Math.min(99, Math.max(0, nextFraction)) / 100;
    onUpdate({ audioOffset: Math.round(value * 100) / 100 });
  };

  const tabButton = (id: Tab, label: string, icon: React.ReactNode) => (
    <button
      onClick={() => {
        setTab(id);
        onUpdate({ useYoutubeAudio: id === 'youtube', audioEnabled: id === 'file' });
      }}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '12px',
        borderRadius: '8px',
        border: 'none',
        background: tab === id ? 'var(--border)' : 'var(--bg-grid)',
        color: tab === id ? 'white' : 'var(--text-dim)',
        fontWeight: tab === id ? 'bold' : 'normal',
        cursor: 'pointer',
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <Modal
      title="同期音源設定"
      icon={<Music size={18} color="#a78bfa" />}
      onClose={onClose}
    >
      <div style={{ display: 'flex', gap: '10px' }}>
        {tabButton('file', 'ファイル', <Upload size={16} />)}
        {tabButton('youtube', 'YouTube', <Youtube size={16} color={tab === 'youtube' ? '#ef4444' : undefined} />)}
      </div>

      <div style={{ marginTop: '15px' }}>
        {tab === 'file' ? (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '14px',
              background: 'var(--border)',
              borderRadius: '8px',
              color: 'var(--text)',
              cursor: 'pointer',
            }}
          >
            <Upload size={16} />
            {project.audioEnabled && project.audioUrl ? '音源を変更' : 'オーディオファイルを選択'}
            <input
              type="file"
              accept="audio/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onSelectFile(file);
                e.target.value = '';
              }}
            />
          </label>
        ) : (
          <input
            type="text"
            placeholder="YouTube URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => onUpdate({ youtubeUrl: url.trim() || undefined })}
            style={{
              width: '100%',
              background: 'var(--panel)',
              color: 'white',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '12px',
              outline: 'none',
            }}
          />
        )}
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
          <span style={{ fontSize: '0.85rem' }}>音源ボリューム</span>
          <span style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>{project.audioVolume}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={project.audioVolume}
          onChange={(e) => onUpdate({ audioVolume: parseInt(e.target.value, 10) })}
          style={{ accentColor: '#a78bfa' }}
        />

        <div style={{ ...rowStyle, marginTop: '15px' }}>
          <span style={{ fontSize: '0.85rem' }}>再生開始位置 (秒)</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="text"
              inputMode="numeric"
              value={whole}
              onChange={(e) => setOffset(parseInt(e.target.value, 10) || 0, fraction)}
              style={boxStyle}
            />
            <span style={{ color: 'var(--text-dim)' }}>.</span>
            <input
              type="text"
              inputMode="numeric"
              value={String(fraction).padStart(2, '0')}
              onChange={(e) => setOffset(whole, parseInt(e.target.value, 10) || 0)}
              style={boxStyle}
            />
          </span>
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(30, offset + 10)}
          step="0.01"
          value={offset}
          onChange={(e) => onUpdate({ audioOffset: parseFloat(e.target.value) })}
          style={{ accentColor: 'var(--accent-warm)' }}
        />
      </div>
    </Modal>
  );
}
