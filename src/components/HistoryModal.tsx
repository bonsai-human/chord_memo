import { History, Undo } from 'lucide-react';
import type { HistoryEntry } from '../hooks/useHistory';
import Modal from './Modal';

interface Props {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  onJump: (index: number, direction: 'undo' | 'redo') => void;
  onClose: () => void;
}

export default function HistoryModal({ undoStack, redoStack, onJump, onClose }: Props) {
  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '12px 15px',
    color: 'white',
    cursor: 'pointer',
    marginBottom: '8px',
    textAlign: 'left',
  };

  return (
    <Modal
      title="操作履歴"
      icon={<History size={18} color="var(--accent)" />}
      width={400}
      onClose={onClose}
      footer={
        <div
          style={{
            padding: '12px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.7rem',
          }}
        >
          ※新しい操作をすると後の履歴は破棄されます
        </div>
      }
    >
      {/* 未来側（やり直せる操作）を上から並べる */}
      {redoStack
        .map((entry, index) => ({ entry, index }))
        .reverse()
        .map(({ entry, index }) => (
          <button
            key={`redo-${index}`}
            style={{ ...rowStyle, color: 'var(--text-dim)' }}
            onClick={() => {
              onJump(index, 'redo');
              onClose();
            }}
          >
            <Undo size={14} style={{ transform: 'scaleX(-1)' }} />
            {entry.label}
          </button>
        ))}

      <div
        style={{
          ...rowStyle,
          border: '2px solid var(--accent)',
          justifyContent: 'space-between',
          cursor: 'default',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ color: 'var(--accent)', fontSize: '0.6rem' }}>●</span>
          現在の状態
        </span>
        <span
          style={{
            background: 'rgba(56, 189, 248, 0.15)',
            color: 'var(--accent)',
            fontSize: '0.6rem',
            fontWeight: 'bold',
            padding: '2px 8px',
            borderRadius: '4px',
          }}
        >
          ACTIVE
        </span>
      </div>

      {undoStack
        .map((entry, index) => ({ entry, index }))
        .reverse()
        .map(({ entry, index }) => (
          <button
            key={`undo-${index}`}
            style={rowStyle}
            onClick={() => {
              onJump(index, 'undo');
              onClose();
            }}
          >
            <Undo size={14} color="var(--accent)" />
            {entry.label}
          </button>
        ))}

      {undoStack.length === 0 && redoStack.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px' }}>
          履歴はありません
        </div>
      )}
    </Modal>
  );
}
