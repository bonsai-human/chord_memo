import { Download, FileJson, FileMusic, FileText } from 'lucide-react';
import Modal from './Modal';

export type ExportFormat = 'json' | 'rechord' | 'chordpro';

interface Props {
  onExport: (format: ExportFormat) => void;
  onClose: () => void;
}

interface Entry {
  format: ExportFormat;
  title: string;
  description: string;
  color: string;
  icon: React.ReactNode;
}

const ENTRIES: Entry[] = [
  {
    format: 'json',
    title: 'プロジェクトデータ (JSON)',
    description: 'データのバックアップ用。直接ダウンロードします。',
    color: '#3b82f6',
    icon: <FileJson size={20} />,
  },
  {
    format: 'rechord',
    title: 'rechord.cc 形式',
    description: 'Webサービス「rechord.cc」互換のテキスト。',
    color: '#10b981',
    icon: <FileText size={20} />,
  },
  {
    format: 'chordpro',
    title: 'ChordPro 形式',
    description: '一般的なコード譜フォーマット。',
    color: '#10b981',
    icon: <FileMusic size={20} />,
  },
];

export default function ExportModal({ onExport, onClose }: Props) {
  return (
    <Modal
      title="形式を選択して書き出し"
      icon={<Download size={18} color="var(--accent)" />}
      width={420}
      onClose={onClose}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {ENTRIES.map((entry) => (
          <button
            key={entry.format}
            onClick={() => {
              onExport(entry.format);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              width: '100%',
              padding: '14px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              cursor: 'pointer',
              textAlign: 'left',
              color: 'var(--text)',
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: '40px',
                height: '40px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: `${entry.color}22`,
                color: entry.color,
              }}
            >
              {entry.icon}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
              <span style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{entry.title}</span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                {entry.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
