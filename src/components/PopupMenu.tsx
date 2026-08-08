export interface MenuItem {
  label: string;
  /** 右端に薄く出す補足 */
  hint?: string;
  color?: string;
  checked?: boolean;
  onClick: () => void;
}

interface Props {
  items: MenuItem[];
  position: { top: number; left: number };
  onClose: () => void;
}

const MENU_WIDTH = 200;
const MARGIN = 8;

export default function PopupMenu({ items, position, onClose }: Props) {
  // 画面右端からはみ出さないように寄せる
  const left = Math.max(
    MARGIN,
    Math.min(position.left, window.innerWidth - MENU_WIDTH - MARGIN),
  );

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 3050 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top: position.top,
          left,
          zIndex: 3100,
          background: 'var(--panel)',
          border: '1px solid var(--border-light)',
          borderRadius: '8px',
          boxShadow: '0 15px 30px -10px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          minWidth: '180px',
        }}
      >
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              width: '100%',
              padding: '12px 16px',
              background: 'transparent',
              border: 'none',
              borderTop: i > 0 ? '1px solid var(--border)' : 'none',
              color: item.color || 'white',
              fontSize: '0.85rem',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span>{item.label}</span>
            {item.hint && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{item.hint}</span>
            )}
            {item.checked && <span style={{ color: 'var(--accent-warm)' }}>✓</span>}
          </button>
        ))}
      </div>
    </>
  );
}
