import { HelpCircle, Menu, Music, Pause, Play, Settings, SquareDashed } from 'lucide-react';
import type { Project } from '../types';

interface Props {
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  isPlaying: boolean;
  isInstrumentLoading: boolean;
  onTogglePlay: () => void;
  currentProject: Project | null;
  onOpenHelp: () => void;
  onOpenAudioSync: () => void;
  onOpenSettings: () => void;
  isRangeMode: boolean;
  onToggleRangeMode: () => void;
}

const iconButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '8px',
  background: 'transparent',
  color: 'var(--text-dim)',
  border: 'none',
  cursor: 'pointer',
};

export default function Header({
  isSidebarOpen,
  setIsSidebarOpen,
  isPlaying,
  isInstrumentLoading,
  onTogglePlay,
  currentProject,
  onOpenHelp,
  onOpenAudioSync,
  onOpenSettings,
  isRangeMode,
  onToggleRangeMode,
}: Props) {
  const hasAudio = !!(currentProject?.audioUrl || currentProject?.youtubeUrl);

  return (
    <header
      style={{
        height: '60px',
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: '15px',
        zIndex: 10,
        flexShrink: 0,
      }}
    >
      <button style={iconButton} onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
        <Menu size={20} />
      </button>

      <div style={{ flex: 1 }} />

      <button style={iconButton} title="ヘルプ" onClick={onOpenHelp}>
        <HelpCircle size={20} />
      </button>

      <button
        style={{
          ...iconButton,
          background: hasAudio ? 'var(--panel)' : 'transparent',
          color: hasAudio ? '#a78bfa' : 'var(--border-light)',
          borderRadius: '8px',
        }}
        title="同期音源設定"
        onClick={onOpenAudioSync}
      >
        <Music size={20} />
      </button>

      <button style={iconButton} title="全般設定" onClick={onOpenSettings}>
        <Settings size={20} />
      </button>

      <button
        onClick={onTogglePlay}
        disabled={isInstrumentLoading}
        style={{
          background: isPlaying ? 'var(--danger)' : 'var(--play)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '8px 20px',
          fontWeight: 'bold',
          cursor: isInstrumentLoading ? 'default' : 'pointer',
          opacity: isInstrumentLoading ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: isPlaying
            ? '0 0 15px rgba(239, 68, 68, 0.4)'
            : '0 4px 6px rgba(16, 185, 129, 0.2)',
        }}
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <button
        title="範囲選択モード"
        disabled={isPlaying}
        onClick={onToggleRangeMode}
        style={{
          background: isRangeMode ? 'var(--accent)' : 'var(--border)',
          color: isRangeMode ? 'var(--bg)' : 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '10px',
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          opacity: isPlaying ? 0.5 : 1,
        }}
      >
        <SquareDashed size={18} />
      </button>
    </header>
  );
}
