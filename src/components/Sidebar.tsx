import { useState } from 'react';
import { Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import type { Project } from '../types';

interface Props {
  isOpen: boolean;
  isMobile: boolean;
  onRequestClose: () => void;
  projects: Project[];
  currentProject: Project | null;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

const actionButton: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '6px',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  color: 'var(--accent)',
  fontSize: '0.8rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  cursor: 'pointer',
  width: '100%',
};

export default function Sidebar({
  isOpen,
  isMobile,
  onRequestClose,
  projects,
  currentProject,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onImport,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const commitRename = (id: string) => {
    if (editingName.trim()) onRename(id, editingName.trim());
    setEditingId(null);
  };

  // 画面が狭いときは本文を押しのけず、上に覆いかぶさる
  const panelStyle: React.CSSProperties = isMobile
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: '260px',
        zIndex: 2000,
        transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.2s',
        borderRight: '1px solid var(--border)',
        boxShadow: isOpen ? '4px 0 20px rgba(0,0,0,0.5)' : 'none',
      }
    : {
        width: isOpen ? '260px' : '0',
        flexShrink: 0,
        borderRight: isOpen ? '1px solid var(--border)' : 'none',
        transition: 'width 0.2s',
      };

  return (
    <>
      {isMobile && isOpen && (
        <div
          onClick={onRequestClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 1999,
          }}
        />
      )}
      <div
        style={{
          ...panelStyle,
          background: 'var(--bg)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
      <div
        style={{
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          padding: '0 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: '1.3rem', color: 'var(--accent)', margin: 0 }}>Chord Memo</h1>
      </div>

      <div style={{ padding: '10px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 10px',
          }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-dim)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            My Projects
          </span>
          <button
            onClick={onCreate}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}
          >
            <Plus size={18} />
          </button>
        </div>

        {projects.map((project) => {
          const isCurrent = currentProject?.id === project.id;
          return (
            <div
              key={project.id}
              onClick={() => onSelect(project)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: isCurrent ? 'var(--panel)' : 'transparent',
                borderRadius: '8px',
                padding: '12px 10px',
                marginBottom: '4px',
                cursor: 'pointer',
              }}
            >
              {editingId === project.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => commitRename(project.id)}
                  onKeyDown={(e) => e.key === 'Enter' && commitRename(project.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'var(--bg-grid)',
                    color: 'white',
                    border: '1px solid var(--border)',
                    borderRadius: '4px',
                    padding: '4px 6px',
                  }}
                />
              ) : (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: '0.9rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {project.name}
                </span>
              )}
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  title="タイトル編集"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingId(project.id);
                    setEditingName(project.name);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  title="削除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(project.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '20px' }}>
          <button style={actionButton} onClick={onExport}>
            <Download size={14} />
            プロジェクトを書き出し
          </button>
          <label style={actionButton}>
            <Upload size={14} />
            ファイルを読み込み
            <input
              type="file"
              accept=".json,.txt,.cho,.pro,.chopro,.crd,.chordpro"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onImport(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        </div>
      </div>
    </>
  );
}
