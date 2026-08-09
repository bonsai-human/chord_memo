import { useCallback, useRef } from 'react';

const THRESHOLD_MS = 600;
const MOVE_TOLERANCE_PX = 10;
/** タッチ直後のゴーストクリックを無視する時間 */
const TOUCH_GUARD_MS = 500;

interface Options {
  onLongPress: () => void;
  onClick?: () => void;
  threshold?: number;
}

export function useLongPress({ onLongPress, onClick, threshold = THRESHOLD_MS }: Options) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const touched = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const start = useCallback(
    (x: number, y: number) => {
      fired.current = false;
      origin.current = { x, y };
      timer.current = setTimeout(() => {
        fired.current = true;
        document.body.classList.add('long-press-active');
        onLongPress();
      }, threshold);
    },
    [onLongPress, threshold],
  );

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const finish = useCallback(() => {
    cancel();
    document.body.classList.remove('long-press-active');
    if (!fired.current && onClick) onClick();
    fired.current = false;
    origin.current = null;
    setTimeout(() => {
      touched.current = false;
    }, TOUCH_GUARD_MS);
  }, [cancel, onClick]);

  const move = useCallback(
    (x: number, y: number) => {
      if (!origin.current || fired.current) return;
      if (
        Math.abs(x - origin.current.x) > MOVE_TOLERANCE_PX ||
        Math.abs(y - origin.current.y) > MOVE_TOLERANCE_PX
      ) {
        cancel();
      }
    },
    [cancel],
  );

  return {
    onTouchStart: (e: React.TouchEvent) => {
      touched.current = true;
      if (e.cancelable) e.preventDefault();
      start(e.touches[0].clientX, e.touches[0].clientY);
    },
    onTouchEnd: (e: React.TouchEvent) => {
      if (e.cancelable) e.preventDefault();
      finish();
    },
    onTouchMove: (e: React.TouchEvent) => {
      move(e.touches[0].clientX, e.touches[0].clientY);
    },
    onMouseDown: (e: React.MouseEvent) => {
      if (touched.current) return;
      if (e.button === 0) start(e.clientX, e.clientY);
    },
    onMouseUp: (e: React.MouseEvent) => {
      if (touched.current) return;
      // 右クリックはメニューを開くだけ。ここで finish() すると
      // メニューと同時に通常のクリック動作まで走ってしまう
      if (e.button !== 0) {
        cancel();
        return;
      }
      finish();
    },
    onMouseMove: (e: React.MouseEvent) => {
      if (touched.current) return;
      move(e.clientX, e.clientY);
    },
    onMouseLeave: () => {
      if (touched.current) return;
      cancel();
      fired.current = false;
      origin.current = null;
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      if (touched.current) return;
      cancel();
      fired.current = true;
      onLongPress();
    },
    style: {
      WebkitTapHighlightColor: 'transparent',
      WebkitTouchCallout: 'none',
      userSelect: 'none',
      touchAction: 'none',
    } as React.CSSProperties,
  };
}
