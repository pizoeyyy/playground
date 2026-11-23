import { useEffect, useRef } from 'react';
import { canUndoItem } from '../shared/session.ts';
import { closeItemMenu, deleteComment, focusComment, setState, undoChange, useStore } from './store.ts';

/** Right-click menu for comments and revision items: the place to undo a change Claude made. */
export function ItemMenu() {
  const menu = useStore((s) => s.itemMenu);
  const session = useStore((s) => s.session);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]:not([disabled])')?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeItemMenu();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeItemMenu();
    addEventListener('pointerdown', away, true);
    addEventListener('keydown', esc, true);
    return () => {
      removeEventListener('pointerdown', away, true);
      removeEventListener('keydown', esc, true);
    };
  }, [menu]);

  if (!menu || !session) return null;
  const undoable = menu.round !== null && canUndoItem(session, menu.round, menu.item);
  const round = menu.round !== null ? session.rounds.find((r) => r.n === menu.round) : undefined;
  const undone = round?.review[menu.item]?.verdict === 'undone';
  const why = undone
    ? 'Already undone'
    : menu.round === null
      ? 'Claude hasn’t changed anything for this yet'
      : round?.status === 'submitted'
        ? 'Claude is still working on it'
        : !round?.results.some((r) => r.item === menu.item && r.state === 'applied')
          ? 'Claude didn’t change anything for this'
          : 'An undo for this is already with Claude';
  const run = (fn: () => void) => () => {
    closeItemMenu();
    fn();
  };

  return (
    <div
      ref={ref}
      className="ctx item-menu"
      role="menu"
      aria-label="Item actions"
      style={{ left: Math.min(menu.x, innerWidth - 240), top: Math.min(menu.y, innerHeight - 160) }}
      onKeyDown={(e) => {
        const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([disabled])') ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        }
      }}
    >
      <div className="ctx-head">{menu.title}</div>
      <button
        role="menuitem"
        className="ctx-item"
        disabled={!undoable}
        title={undoable ? undefined : why}
        onClick={run(() => undoChange(menu.round!, menu.item))}
      >
        <span>{menu.comment ? 'Undo change on this comment' : 'Undo this change'}</span>
      </button>
      {!undoable && <div className="ctx-note">{why}</div>}
      {menu.comment && (
        <>
          <div className="ctx-sep" />
          <button role="menuitem" className="ctx-item" onClick={run(() => focusComment(menu.item))}>
            <span>Open on page</span>
          </button>
          <button
            role="menuitem"
            className="ctx-item"
            onClick={run(() => {
              focusComment(menu.item);
              setState({ tab: 'comments' });
            })}
          >
            <span>Reply</span>
          </button>
          <div className="ctx-sep" />
          <button role="menuitem" className="ctx-item" data-danger onClick={run(() => deleteComment(menu.item))}>
            <span>Delete comment</span>
            <kbd>Del</kbd>
          </button>
        </>
      )}
    </div>
  );
}
