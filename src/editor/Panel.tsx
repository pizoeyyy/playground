import { useEffect, useRef, useState } from 'react';
import { latestRound, roundItems } from '../shared/session.ts';
import type { Comment, Op, Round } from '../shared/types.ts';
import { IconCheck } from './icons.tsx';
import { act, focusComment, getState, openComposer, setState, toAgent, useStore } from './store.ts';

export function Panel() {
  const tab = useStore((s) => s.tab);
  const session = useStore((s) => s.session);
  const round = session && latestRound(session);
  const open = session?.comments.filter((c) => c.status === 'open').length ?? 0;
  return (
    <aside className="panel">
      {round && round.status !== 'confirmed' && <RoundCard round={round} />}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inspect'} data-active={tab === 'inspect' || undefined} onClick={() => setState({ tab: 'inspect' })}>
          Inspect
        </button>
        <button role="tab" aria-selected={tab === 'comments'} data-active={tab === 'comments' || undefined} onClick={() => setState({ tab: 'comments' })}>
          Comments{open > 0 && <span className="count">{open}</span>}
        </button>
      </div>
      <div className="panel-body">{tab === 'inspect' ? <Inspector /> : <Comments />}</div>
    </aside>
  );
}

// ---------------- inspector ----------------

function toHex(css: string): { hex: string; transparent: boolean } {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return { hex: css.startsWith('#') ? css.slice(0, 7) : '#000000', transparent: false };
  const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
  const h = [r, g, b].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
  return { hex: `#${h}`, transparent: Number(a) === 0 };
}

function ColorField({ label, prop, value, selector }: { label: string; prop: string; value: string; selector: string }) {
  const { hex, transparent } = toHex(value);
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(hex);
  useEffect(() => setText(transparent ? '' : hex), [hex, transparent]);
  useEffect(() => {
    const el = ref.current!;
    const commit = () => toAgent({ type: 'style', selector, prop, value: el.value, commit: true });
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [selector, prop]);
  const commitText = () => {
    const v = text.trim();
    if (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) toAgent({ type: 'style', selector, prop, value: v.startsWith('#') ? v : '#' + v, commit: true });
    else setText(transparent ? '' : hex);
  };
  return (
    <label className="field color">
      <span className="flabel">{label}</span>
      <span className="swatch" data-transparent={transparent || undefined}>
        <input
          ref={ref}
          type="color"
          value={hex}
          onInput={(e) => toAgent({ type: 'style', selector, prop, value: (e.target as HTMLInputElement).value, commit: false })}
          aria-label={`${label} colour`}
        />
      </span>
      <input
        className="hex"
        value={text}
        placeholder={transparent ? 'none' : ''}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        spellCheck={false}
      />
    </label>
  );
}

function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(Math.round(value))), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n) && n !== Math.round(value)) onCommit(n);
    else setV(String(Math.round(value)));
  };
  return (
    <label className="field num">
      <span className="flabel">{label}</span>
      <input
        inputMode="numeric"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const step = (e.shiftKey ? 1 : getState().gridSize) * (e.key === 'ArrowUp' ? 1 : -1);
            onCommit(Math.round(value) + step);
          }
        }}
      />
    </label>
  );
}

function Inspector() {
  const sel = useStore((s) => s.selected);
  const [text, setText] = useState('');
  useEffect(() => setText(sel?.text ?? ''), [sel?.selector, sel?.text]);

  if (!sel) {
    return (
      <div className="empty">
        <p>Select something on the page.</p>
        <p className="muted">Right-click any element for <b>Click this button</b>, <b>Request change</b>, and more.</p>
        <Shortcuts />
      </div>
    );
  }
  const s = sel.selector;
  return (
    <div className="inspector">
      <div className="el-head">
        <span className="el-name" title={sel.selector}>{sel.element}</span>
        <code className="el-tag">{sel.tag}</code>
      </div>
      <div className="row wrap">
        <button className="chip" onClick={() => toAgent({ type: 'click', selector: s })}>Click it</button>
        <button className="chip" onClick={() => openComposer('comment')}>Comment</button>
        <button className="chip accent" onClick={() => openComposer('change-request')}>Request change</button>
      </div>

      <h4>Colour</h4>
      <ColorField label="Fill" prop="background-color" value={sel.styles.background} selector={s} />
      <ColorField label="Text" prop="color" value={sel.styles.color} selector={s} />
      <ColorField label="Border" prop="border-color" value={sel.styles.border} selector={s} />

      {sel.text !== null && (
        <>
          <h4>Content</h4>
          <input
            className="text-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => text !== sel.text && toAgent({ type: 'text', selector: s, value: text })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </>
      )}

      <h4>Position</h4>
      <div className="row">
        <NumberField label="X" value={sel.translate.x} onCommit={(x) => toAgent({ type: 'nudge', selector: s, x, y: sel.translate.y })} />
        <NumberField label="Y" value={sel.translate.y} onCommit={(y) => toAgent({ type: 'nudge', selector: s, x: sel.translate.x, y })} />
      </div>
      <p className="muted small">Drag on the page to move. It snaps to the grid and to neighbours; hold Alt to place freely. Claude turns rough moves into clean layout.</p>

      <h4>Element</h4>
      <div className="row wrap">
        {sel.text !== null && <button className="chip" onClick={() => toAgent({ type: 'editText', selector: s })}>Edit text</button>}
        <button className="chip" onClick={() => toAgent({ type: 'duplicate', selector: s })}>Duplicate</button>
        <button className="chip" onClick={() => toAgent({ type: 'selectParent', selector: s })}>Select parent</button>
        <button className="chip danger" onClick={() => toAgent({ type: 'delete', selector: s })}>Delete</button>
      </div>
    </div>
  );
}

function Shortcuts() {
  const rows: [string, string][] = [
    ['V', 'Select and move'],
    ['I', 'Interact with the page'],
    ['B', 'Add a button'],
    ['C', 'Comment'],
    ["'", 'Grid'],
    ['Ctrl Z', 'Undo'],
    ['Ctrl Shift Z', 'Redo'],
    ['Arrows', 'Nudge 8px (Shift: 1px)'],
    ['Enter', 'Edit text'],
    ['Del', 'Delete'],
    ['Ctrl Enter', 'Save and send'],
  ];
  return (
    <dl className="shortcuts">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt><kbd>{k}</kbd></dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------- comments ----------------

function Comments() {
  const session = useStore((s) => s.session);
  const current = useStore((s) => s.current);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  if (!session) return null;
  const list = session.comments.filter((c) => (filter === 'all' ? true : c.status !== 'resolved'));
  return (
    <div className="comments">
      <div className="row">
        <div className="seg small">
          <button data-active={filter === 'open' || undefined} onClick={() => setFilter('open')}>Active</button>
          <button data-active={filter === 'all' || undefined} onClick={() => setFilter('all')}>All</button>
        </div>
      </div>
      {list.length === 0 && <p className="muted">No comments yet. Press C, or right-click an element → Request change.</p>}
      {session.slides.map((sl, i) => {
        const items = list.filter((c) => c.slide === sl.id);
        if (!items.length) return null;
        return (
          <section key={sl.id}>
            <h4 data-current={sl.id === current || undefined}>{i + 1} · {sl.label}</h4>
            {items.map((c) => (
              <CommentCard key={c.id} c={c} n={session.comments.indexOf(c) + 1} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function CommentCard({ c, n }: { c: Comment; n: number }) {
  return (
    <button className="card" data-status={c.status} onClick={() => focusComment(c.id)}>
      <div className="card-head">
        <span className="pin-dot" data-type={c.type}>{n}</span>
        <span className="kind">{c.type === 'change-request' ? 'Change request' : 'Comment'}</span>
        <span className="status" data-status={c.status}>{c.status}</span>
      </div>
      <div className="on">{c.element}</div>
      <p className="body">{c.body}</p>
      {c.replies.slice(-1).map((r, i) => (
        <p key={i} className="reply" data-author={r.author}>
          <b>{r.author === 'claude' ? 'Claude' : 'You'}</b> {r.body}
        </p>
      ))}
    </button>
  );
}

// ---------------- the review loop ----------------

function RoundCard({ round }: { round: Round }) {
  const [reopening, setReopening] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (round.status === 'submitted') {
    return (
      <div className="round working">
        <span className="dot" aria-hidden />
        <div>
          <b>Round {round.n} sent</b>
          <span className="muted"> · Claude is working on {round.ops.length + round.comments.length} item(s)…</span>
        </div>
      </div>
    );
  }
  const items = roundItems(round);
  const reviewed = Object.keys(round.review).length;
  return (
    <div className="round ready">
      <div className="round-head">
        <b>Revision {round.n} ready</b>
        <span className="muted">{reviewed}/{items.length} reviewed</span>
        <span className="grow" />
        {Object.keys(round.shots).length > 0 && (
          <button className="ghost small" onClick={() => setState({ compare: round.n })}>Before / After</button>
        )}
      </div>
      <ul className="items">
        {items.map((it) => {
          const res = round.results.find((r) => r.item === it.id);
          const verdict = round.review[it.id]?.verdict;
          return (
            <li key={it.id} data-verdict={verdict}>
              <div className="what">{'kind' in it ? (it as Op).label : `“${(it as Comment).body}”`}</div>
              {res && (
                <div className="note" data-state={res.state}>
                  <b>Claude</b> {res.state === 'question' ? '(question) ' : ''}{res.note}
                </div>
              )}
              {verdict ? (
                <div className="verdict">{verdict === 'confirmed' ? 'Confirmed' : 'Reopened'}</div>
              ) : reopening === it.id ? (
                <div className="reopen">
                  <input autoFocus value={note} placeholder="What's still wrong?" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      act({ type: 'review', round: round.n, item: it.id, verdict: 'reopened', note: note.trim() || undefined, at: Date.now() });
                      setReopening(null);
                      setNote('');
                    }
                    if (e.key === 'Escape') setReopening(null);
                  }} />
                </div>
              ) : (
                <div className="row">
                  <button className="ghost small" onClick={() => setReopening(it.id)}>Reopen</button>
                  <button className="primary small" onClick={() => act({ type: 'review', round: round.n, item: it.id, verdict: 'confirmed', at: Date.now() })}>
                    <IconCheck /> Confirm
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row end">
        <button className="primary" onClick={() => act({ type: 'confirmAll', round: round.n })}>Confirm all</button>
      </div>
    </div>
  );
}

export function CompareModal() {
  const n = useStore((s) => s.compare);
  const session = useStore((s) => s.session);
  const round = session?.rounds.find((r) => r.n === n);
  useEffect(() => {
    if (!round) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ compare: null });
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [round]);
  if (!round || !session) return null;
  return (
    <div className="modal-bg" onClick={() => setState({ compare: null })}>
      <div className="modal" role="dialog" aria-label={`Before and after, round ${round.n}`} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <b>Round {round.n} · before and after</b>
          <span className="grow" />
          <button className="ghost" onClick={() => setState({ compare: null })}>Close</button>
        </div>
        {Object.entries(round.shots).map(([id, before]) => {
          const sl = session.slides.find((s) => s.id === id);
          return (
            <div key={id} className="compare">
              <h4>{sl?.label ?? id}</h4>
              <div className="pair">
                <figure><img src={before} alt="Your edits as sent" /><figcaption>Your edits (sent)</figcaption></figure>
                <figure>{sl?.thumb ? <img src={sl.thumb} alt="Claude's revision" /> : <div className="blank" />}<figcaption>Claude's revision</figcaption></figure>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
