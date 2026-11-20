import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COMMENT_LABEL, type Comment, type CommentType } from '../shared/types.ts';
import {
  act,
  addComment,
  closeMenu,
  toAgent,
  DEVICE_WIDTH,
  getState,
  setMode,
  focusComment,
  setIframe,
  setState,
  syncPins,
  useStore,
} from './store.ts';

export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 800 });
  const device = useStore((s) => s.device);
  const frameOrigin = useStore((s) => s.frameOrigin);
  const frameUrl = useStore((s) => s.frameUrl);
  const frameKey = useStore((s) => s.frameKey);
  const mode = useStore((s) => s.mode);

  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const width = DEVICE_WIDTH[device];
  const scale = Math.min(1, (size.w - 64) / width);
  const height = Math.max(400, (size.h - 48) / scale);

  // The page draws handles and snaps in its own pixels; tell it the zoom so they stay usable on screen.
  useEffect(() => {
    if (getState().zoom === scale) return;
    setState({ zoom: scale });
    toAgent({ type: 'zoom', scale });
  }, [scale]);

  return (
    <main className="stage" ref={ref} data-mode={mode}>
      {frameOrigin && (
        <div className="frame-wrap" style={{ width: width * scale, height: height * scale }}>
          <div className="frame-inner" style={{ width, height, transform: `scale(${scale})` }}>
            <iframe
              key={frameKey}
              ref={setIframe}
              src={frameOrigin + frameUrl}
              title="Page under review"
              width={width}
              height={height}
            />
            <PlaceLayer scale={scale} />
            <Overlay scale={scale} width={width} />
          </div>
        </div>
      )}
      {scale < 1 && <div className="zoom">{Math.round(scale * 100)}%</div>}
    </main>
  );
}

/** Catches the click that places a new component or comment, in the editor's own event loop. */
function PlaceLayer({ scale }: { scale: number }) {
  const mode = useStore((s) => s.mode);
  const addKind = useStore((s) => s.addKind);
  if (mode !== 'add' && mode !== 'comment') return null;
  return (
    <div
      className="place-layer"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        toAgent({ type: 'place', x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale, what: mode, kind: addKind });
        setMode('select');
      }}
    />
  );
}

function Overlay({ scale, width }: { scale: number; width: number }) {
  const session = useStore((s) => s.session);
  const current = useStore((s) => s.current);
  const rects = useStore((s) => s.rects);
  const composer = useStore((s) => s.composer);
  const openThread = useStore((s) => s.openThread);

  const comments = session?.comments ?? [];
  useEffect(() => syncPins(), [comments.length, current]);

  const visible = comments.filter((c) => c.slide === current && c.status !== 'resolved');
  const perSelector = new Map<string, number>();
  const inv = 1 / scale;

  return (
    <div className="frame-overlay">
      {visible.map((c) => {
        const r = rects[c.selector];
        if (!r) return null;
        const k = perSelector.get(c.selector) ?? 0;
        perSelector.set(c.selector, k + 1);
        const n = comments.indexOf(c) + 1;
        return (
          <button
            key={c.id}
            className="pin"
            data-type={c.type}
            data-status={c.status}
            data-open={openThread === c.id || undefined}
            style={{
              left: Math.min(width - 28 * inv, Math.max(4, r.x + r.w - 6 + k * 22 * inv)),
              top: Math.max(4, r.y - 24 * inv),
              transform: `scale(${inv})`,
            }}
            title={`${COMMENT_LABEL[c.type]}: ${c.body}`}
            onClick={() => (openThread === c.id ? setState({ openThread: null }) : focusComment(c.id))}
          >
            {n}
          </button>
        );
      })}
      <ContextMenu scale={scale} width={width} />
      {composer && composer.slide === current && (
        <Popover rect={composer.rect} scale={scale} width={width}>
          <ComposerForm key={composer.selector + composer.kind} initial={composer.kind} element={composer.element} />
        </Popover>
      )}
      {openThread &&
        (() => {
          const c = comments.find((x) => x.id === openThread);
          const r = c && rects[c.selector];
          if (!c || !r || c.slide !== current) return null;
          return (
            <Popover rect={r} scale={scale} width={width}>
              <Thread comment={c} n={comments.indexOf(c) + 1} />
            </Popover>
          );
        })()}
    </div>
  );
}

function ContextMenu({ scale, width }: { scale: number; width: number }) {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const inv = 1 / scale;

  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [menu]);

  if (!menu) return null;
  const s = menu.selector;
  const run = (fn: () => void) => () => {
    closeMenu();
    fn();
  };
  const items: ({ label: string; hint?: string; danger?: boolean; run: () => void } | 'sep')[] = [
    { label: menu.clickable ? 'Click this button' : 'Click this element', run: run(() => toAgent({ type: 'click', selector: s })) },
    'sep',
    { label: 'Describe behavior…', run: run(() => toAgent({ type: 'compose', selector: s, kind: 'behavior' })) },
    { label: 'Request change…', run: run(() => toAgent({ type: 'compose', selector: s, kind: 'change-request' })) },
    { label: 'Comment…', hint: 'C', run: run(() => toAgent({ type: 'compose', selector: s, kind: 'comment' })) },
    'sep',
    ...(menu.hasText ? [{ label: 'Edit text', hint: 'Enter', run: run(() => toAgent({ type: 'editText', selector: s })) }] : []),
    { label: 'Duplicate', hint: 'Ctrl D', run: run(() => toAgent({ type: 'duplicate', selector: s })) },
    ...(menu.hasParent ? [{ label: 'Select parent', hint: 'Shift Enter', run: run(() => toAgent({ type: 'selectParent', selector: s })) }] : []),
    'sep',
    { label: 'Delete', hint: 'Del', danger: true, run: run(() => toAgent({ type: 'delete', selector: s })) },
  ];
  const menuW = 220 * inv;
  const left = Math.min(menu.x, width - menuW - 8);

  return (
    <div
      ref={ref}
      className="ctx"
      role="menu"
      aria-label={`Actions for ${menu.element}`}
      style={{ left, top: menu.y, transform: `scale(${inv})` }}
      onKeyDown={(e) => {
        const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        const i = all.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]?.focus();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          closeMenu();
        }
      }}
    >
      <div className="ctx-head">{menu.element}</div>
      {items.map((it, i) =>
        it === 'sep' ? (
          <div key={i} className="ctx-sep" />
        ) : (
          <button key={it.label} role="menuitem" className="ctx-item" data-danger={it.danger || undefined} onClick={it.run}>
            <span>{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}

function Popover({ rect, scale, width, children }: { rect: { x: number; y: number; w: number; h: number }; scale: number; width: number; children: React.ReactNode }) {
  const inv = 1 / scale;
  const w = 300 * inv;
  const right = rect.x + rect.w + 10;
  const left = right + w < width ? right : Math.max(8, rect.x - w - 10);
  return (
    <div className="popover" style={{ left, top: Math.max(8, rect.y), transform: `scale(${inv})` }}>
      {children}
    </div>
  );
}

const PLACEHOLDER: Record<CommentType, string> = {
  behavior: 'When someone uses this, what should happen? e.g. "On click, open the confirm popup. Cancel closes it."',
  'change-request': 'What should change?',
  comment: 'What do you think, or what does this do?',
};

function ComposerForm({ initial, element }: { initial: CommentType; element: string }) {
  const [kind, setKind] = useState<CommentType>(initial);
  const [body, setBody] = useState('');
  const submit = () => addComment(kind, body);
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="seg" role="radiogroup" aria-label="Type">
        {(['behavior', 'change-request', 'comment'] as CommentType[]).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={kind === t} data-active={kind === t || undefined} onClick={() => setKind(t)}>
            {t === 'behavior' ? 'Behavior' : t === 'change-request' ? 'Change' : 'Note'}
          </button>
        ))}
      </div>
      <div className="on">on {element}</div>
      <textarea
        autoFocus
        rows={3}
        value={body}
        placeholder={PLACEHOLDER[kind]}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') setState({ composer: null });
        }}
      />
      <div className="row end">
        <button type="button" className="ghost" onClick={() => setState({ composer: null })}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!body.trim()}>
          Post
        </button>
      </div>
    </form>
  );
}

export function Thread({ comment: c, n }: { comment: Comment; n: number }) {
  const [reply, setReply] = useState('');
  const send = () => {
    if (!reply.trim()) return;
    act({ type: 'reply', id: c.id, reply: { author: 'you', body: reply.trim(), at: Date.now() } });
    if (c.status !== 'open' && c.status !== 'sent') act({ type: 'setCommentStatus', id: c.id, status: 'open' });
    setReply('');
  };
  return (
    <div className="thread">
      <div className="thread-head">
        <span className="pin-dot" data-type={c.type}>{n}</span>
        <span className="kind">{COMMENT_LABEL[c.type]}</span>
        <span className="status" data-status={c.status}>{c.status}</span>
        <button className="x" aria-label="Close" onClick={() => setState({ openThread: null })}>×</button>
      </div>
      <div className="on">on {c.element}</div>
      <p className="body">{c.body}</p>
      {c.replies.map((r, i) => (
        <p key={i} className="reply" data-author={r.author}>
          <b>{r.author === 'claude' ? 'Claude' : 'You'}</b> {r.body}
        </p>
      ))}
      <textarea
        rows={2}
        value={reply}
        placeholder="Reply"
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
        }}
      />
      <div className="row">
        <button className="ghost danger" onClick={() => { act({ type: 'deleteComment', id: c.id }); setState({ openThread: null }); }}>
          Delete
        </button>
        <span className="grow" />
        {c.status !== 'resolved' && (
          <button className="ghost" onClick={() => { act({ type: 'setCommentStatus', id: c.id, status: 'resolved' }); setState({ openThread: null }); }}>
            Resolve
          </button>
        )}
        <button className="primary" disabled={!reply.trim()} onClick={send}>
          Reply
        </button>
      </div>
    </div>
  );
}

