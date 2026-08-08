import { useRef } from 'react';
import { CirclePlus, Clipboard, Copy, Flag, Redo, Scissors, Trash2, Undo } from 'lucide-react';
import { useLongPress } from '../hooks/useLongPress';

export type MenuKind = 'rhythm' | 'paste' | 'undo' | 'redo' | 'delete' | 'settings' | 'label';

export interface Anchor {
  top: number;
  left: number;
}

interface Props {
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  isRangeMode: boolean;
  hasSelection: boolean;
  isMobile: boolean;
  onOpenMenu: (kind: MenuKind, anchor: Anchor) => void;
  onCopy: () => void;
  onPaste: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
}

interface ButtonProps {
  title: string;
  icon: React.ReactNode;
  color: string;
  compact: boolean;
  disabled?: boolean;
  onClick: (anchor: Anchor) => void;
  onLongPress?: (anchor: Anchor) => void;
}

function ActionButton({ title, icon, color, compact, disabled, onClick, onLongPress }: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const anchor = (): Anchor => {
    const rect = ref.current?.getBoundingClientRect();
    return { top: (rect?.top ?? 0) - 8, left: rect?.left ?? 0 };
  };

  const handlers = useLongPress({
    onLongPress: () => {
      if (!disabled && onLongPress) onLongPress(anchor());
    },
    onClick: () => {
      if (!disabled) onClick(anchor());
    },
  });

  return (
    <button
      ref={ref}
      title={title}
      disabled={disabled}
      {...handlers}
      style={{
        ...handlers.style,
        background: 'var(--border)',
        border: 'none',
        borderRadius: '6px',
        padding: compact ? '7px 8px' : '6px 12px',
        color: disabled ? 'var(--border-light)' : color,
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon}
    </button>
  );
}

export default function ActionBar({
  canPaste,
  canUndo,
  canRedo,
  isRangeMode,
  hasSelection,
  isMobile,
  onOpenMenu,
  onCopy,
  onPaste,
  onUndo,
  onRedo,
  onDelete,
}: Props) {
  const accent = 'var(--accent)';
  const iconSize = 18;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        padding: isMobile ? '8px 4px' : '10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          gap: isMobile ? '4px' : '8px',
          background: 'var(--panel)',
          borderRadius: '10px',
          padding: isMobile ? '6px' : '7px',
          maxWidth: '100%',
        }}
      >
        <ActionButton
          title="リズムを変更・分割"
          icon={<Scissors size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!hasSelection}
          onClick={(a) => onOpenMenu('rhythm', a)}
        />
        <ActionButton
          title="コピー"
          icon={<Copy size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!hasSelection}
          onClick={onCopy}
        />
        <ActionButton
          title="貼り付け (長押しでメニュー)"
          icon={<Clipboard size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!canPaste || !hasSelection}
          onClick={onPaste}
          onLongPress={(a) => onOpenMenu('paste', a)}
        />
        <ActionButton
          title="元に戻す (長押しで履歴)"
          icon={<Undo size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!canUndo}
          onClick={onUndo}
          onLongPress={(a) => onOpenMenu('undo', a)}
        />
        <ActionButton
          title="やり直し (長押しで履歴)"
          icon={<Redo size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!canRedo}
          onClick={onRedo}
          onLongPress={(a) => onOpenMenu('redo', a)}
        />
        <ActionButton
          title="削除 (長押しでメニュー)"
          icon={<Trash2 size={iconSize} />}
          color="var(--danger)"
          compact={isMobile}
          disabled={!hasSelection}
          onClick={onDelete}
          onLongPress={(a) => onOpenMenu('delete', a)}
        />
        <ActionButton
          title="設定を追加"
          icon={<CirclePlus size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!hasSelection}
          onClick={(a) => onOpenMenu('settings', a)}
        />
        <ActionButton
          title="ラベル設定（範囲選択時のみ）"
          icon={<Flag size={iconSize} />}
          color={accent}
          compact={isMobile}
          disabled={!isRangeMode || !hasSelection}
          onClick={(a) => onOpenMenu('label', a)}
        />
      </div>
    </div>
  );
}
