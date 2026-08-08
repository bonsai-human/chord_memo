import { useEffect, useRef, useState } from 'react';
import { PLAYER_CONTAINER_ID } from '../lib/youtube';

const WIDTH = 200;
const HEIGHT = 130;
const MARGIN = 16;

/**
 * 規約上ここでプレイヤーを隠すことはできないので、
 * 邪魔にならないようドラッグで動かせるようにしている。
 */
export default function YouTubePlayer({ visible }: { visible: boolean }) {
  const [position, setPosition] = useState({
    x: window.innerWidth - WIDTH - MARGIN,
    y: window.innerHeight - HEIGHT - MARGIN,
  });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current) return;
      setPosition({
        x: Math.min(Math.max(0, e.clientX - drag.current.dx), window.innerWidth - WIDTH),
        y: Math.min(Math.max(0, e.clientY - drag.current.dy), window.innerHeight - HEIGHT),
      });
    };
    const onUp = () => {
      drag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: WIDTH,
        zIndex: 2500,
        background: 'var(--panel)',
        border: '1px solid var(--border-light)',
        borderRadius: '6px',
        overflow: 'hidden',
        boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
        display: visible ? 'block' : 'none',
      }}
    >
      <div
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
        }}
        style={{
          padding: '3px 8px',
          fontSize: '0.6rem',
          color: 'var(--text-dim)',
          cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
          background: 'var(--border)',
        }}
      >
        YouTube 同期中
      </div>
      <div style={{ width: WIDTH, height: HEIGHT - 20 }}>
        <div id={PLAYER_CONTAINER_ID} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
