import Modal from './Modal';

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = '削除',
  onConfirm,
  onClose,
}: Props) {
  return (
    <Modal title={title} width={380} onClose={onClose}>
      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.6 }}>{message}</p>
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
          onClick={() => {
            onConfirm();
            onClose();
          }}
          style={{
            flex: 1,
            padding: '10px',
            background: 'var(--danger)',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: 'bold',
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
