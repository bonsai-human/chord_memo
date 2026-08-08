import { useCallback, useState } from 'react';
import type { Project } from '../types';

const MAX_ENTRIES = 50;

export interface HistoryEntry {
  project: Project;
  label: string;
}

const snapshot = (project: Project): Project => JSON.parse(JSON.stringify(project));

export function useHistory() {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  /** 変更を加える直前の状態を積む */
  const push = useCallback((project: Project | null, label = '操作') => {
    if (!project) return;
    setUndoStack((stack) => {
      const next = [...stack, { project: snapshot(project), label }];
      return next.length > MAX_ENTRIES ? next.slice(1) : next;
    });
    setRedoStack([]);
  }, []);

  const undo = useCallback(
    (current: Project | null, apply: (p: Project) => void, notify: (msg: string) => void) => {
      if (undoStack.length === 0 || !current) return;
      const entry = undoStack[undoStack.length - 1];
      setUndoStack((s) => s.slice(0, -1));
      setRedoStack((s) => [{ project: snapshot(current), label: entry.label }, ...s]);
      apply(entry.project);
      notify(`「${entry.label}」を取り消しました`);
    },
    [undoStack],
  );

  const redo = useCallback(
    (current: Project | null, apply: (p: Project) => void, notify: (msg: string) => void) => {
      if (redoStack.length === 0 || !current) return;
      const entry = redoStack[0];
      setRedoStack((s) => s.slice(1));
      setUndoStack((s) => [...s, { project: snapshot(current), label: entry.label }]);
      apply(entry.project);
      notify(`「${entry.label}」をやり直しました`);
    },
    [redoStack],
  );

  /** 履歴一覧から任意の時点へ飛ぶ */
  const jumpTo = useCallback(
    (
      index: number,
      direction: 'undo' | 'redo',
      current: Project | null,
      apply: (p: Project) => void,
      notify: (msg: string) => void,
    ) => {
      if (!current) return;
      if (direction === 'undo') {
        if (index < 0 || index >= undoStack.length) return;
        const target = undoStack[index];
        const moved = [
          ...undoStack.slice(index + 1).reverse(),
          { project: snapshot(current), label: undoStack[index].label },
          ...redoStack,
        ];
        setUndoStack(undoStack.slice(0, index));
        setRedoStack(moved);
        apply(target.project);
        notify(`「${target.label}」の時点まで戻しました`);
      } else {
        if (index < 0 || index >= redoStack.length) return;
        const target = redoStack[index];
        const moved = [
          ...undoStack,
          { project: snapshot(current), label: redoStack[0].label },
          ...redoStack.slice(0, index),
        ];
        setUndoStack(moved);
        setRedoStack(redoStack.slice(index + 1));
        apply(target.project);
        notify(`「${target.label}」の時点まで進めました`);
      }
    },
    [undoStack, redoStack],
  );

  return { undoStack, redoStack, push, undo, redo, jumpTo };
}
