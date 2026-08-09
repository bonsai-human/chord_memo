import { useState } from 'react';
import {
  CirclePlus,
  Clipboard,
  Copy,
  Download,
  Flag,
  HelpCircle,
  Image,
  Music,
  MousePointer,
  Play,
  Scissors,
  Settings,
  SquareDashed,
  Trash2,
  Undo,
  type LucideIcon,
} from 'lucide-react';
import Modal from './Modal';
import { HELP_TABS } from './helpContent';

const ICONS: Record<string, LucideIcon> = {
  CirclePlus,
  Clipboard,
  Copy,
  Download,
  Flag,
  HelpCircle,
  Image,
  Music,
  MousePointer,
  Play,
  Scissors,
  Settings,
  SquareDashed,
  Trash2,
  Undo,
};

const keyCapStyle: React.CSSProperties = {
  display: 'inline-block',
  background: 'var(--border)',
  border: '1px solid var(--border-light)',
  borderRadius: '4px',
  padding: '1px 6px',
  margin: '0 2px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.75rem',
  color: 'white',
  whiteSpace: 'nowrap',
};

const INLINE_PATTERN = /\*\*(.+?)\*\*|\[icon:(\w+)\]|\[key:([^\]]+)\]/g;

/** `**強調**` / `[icon:Play]` / `[key:Space]` を要素に置き換える */
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let seq = 0;

  INLINE_PATTERN.lastIndex = 0;
  let match = INLINE_PATTERN.exec(text);
  while (match) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const [raw, strong, iconName, keyName] = match;
    if (strong !== undefined) {
      nodes.push(
        <strong key={seq++} style={{ color: '#f8fafc' }}>
          {strong}
        </strong>,
      );
    } else if (iconName !== undefined) {
      const Icon = ICONS[iconName];
      nodes.push(
        Icon ? (
          <Icon
            key={seq++}
            size={16}
            color="var(--accent)"
            style={{ verticalAlign: 'middle', margin: '0 2px' }}
          />
        ) : (
          raw
        ),
      );
    } else {
      nodes.push(
        <span key={seq++} style={keyCapStyle}>
          {keyName}
        </span>,
      );
    }

    cursor = INLINE_PATTERN.lastIndex;
    match = INLINE_PATTERN.exec(text);
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function HelpBody({ text }: { text: string }) {
  return (
    <div style={{ fontSize: '0.85rem', lineHeight: 1.8, color: 'var(--text)' }}>
      {text.split('\n').map((line, index) => {
        if (line.trim() === '') return <div key={index} style={{ height: '10px' }} />;
        if (line.startsWith('* ')) {
          return (
            <div key={index} style={{ display: 'flex', gap: '8px', paddingLeft: '4px' }}>
              <span style={{ color: 'var(--accent)' }}>•</span>
              <span style={{ flex: 1 }}>{renderInline(line.slice(2))}</span>
            </div>
          );
        }
        return <div key={index}>{renderInline(line)}</div>;
      })}
    </div>
  );
}

interface Props {
  onClose: () => void;
}

export default function HelpModal({ onClose }: Props) {
  const [tabId, setTabId] = useState(HELP_TABS[0].id);
  const tab = HELP_TABS.find((t) => t.id === tabId) ?? HELP_TABS[0];

  return (
    <Modal
      title="操作マニュアル"
      icon={<HelpCircle size={18} color="var(--accent)" />}
      width={620}
      onClose={onClose}
      footer={
        <div style={{ padding: '12px 20px', textAlign: 'right', borderTop: '1px solid var(--border)' }}>
          <button
            onClick={onClose}
            style={{
              background: 'var(--accent)',
              color: 'var(--bg)',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 20px',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          >
            閉じる
          </button>
        </div>
      }
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '8px',
          marginBottom: '20px',
        }}
      >
        {HELP_TABS.map((entry) => {
          const isActive = entry.id === tab.id;
          return (
            <button
              key={entry.id}
              onClick={() => setTabId(entry.id)}
              style={{
                background: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? 'var(--bg)' : 'var(--text-dim)',
                fontWeight: isActive ? 'bold' : 'normal',
                border: 'none',
                borderRadius: '20px',
                padding: '6px 16px',
                fontSize: '0.8rem',
                cursor: 'pointer',
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      {tab.sections.map((section) => {
        const Icon = ICONS[section.icon] ?? HelpCircle;
        return (
          <section key={section.title} style={{ marginBottom: '24px' }}>
            <h3
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                margin: '0 0 10px',
                paddingBottom: '8px',
                borderBottom: '1px solid var(--border)',
                color: 'var(--text)',
                fontSize: '0.95rem',
              }}
            >
              <Icon size={18} color="var(--accent)" />
              {section.title}
            </h3>
            <HelpBody text={section.body} />
          </section>
        );
      })}
    </Modal>
  );
}
