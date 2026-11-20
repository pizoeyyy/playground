import { describe, expect, it } from 'vitest';
import { activeOps, canUndo, emptySession, pendingCount, reduce } from '../src/shared/session.ts';
import type { Comment, Op, Session } from '../src/shared/types.ts';

const op = (id: string, extra: Partial<Op> = {}): Op => ({
  id,
  slide: 's1',
  kind: 'style',
  selector: '#buy',
  element: 'button "Buy now"',
  label: `op ${id}`,
  prop: 'color',
  before: 'rgb(0, 0, 0)',
  after: '#ff0000',
  at: 0,
  ...extra,
});

const comment = (id: string, extra: Partial<Comment> = {}): Comment => ({
  id,
  slide: 's1',
  selector: '#buy',
  element: 'button "Buy now"',
  type: 'change-request',
  body: 'Make it green',
  status: 'open',
  replies: [],
  at: 0,
  ...extra,
});

const run = (s: Session, ...actions: Parameters<typeof reduce>[1][]) => actions.reduce(reduce, s);

describe('undo / redo', () => {
  it('moves the pointer and keeps redo-able ops', () => {
    let s = run(emptySession('/x.html', 'file'), { type: 'addOp', op: op('a') }, { type: 'addOp', op: op('b') });
    expect(activeOps(s).map((o) => o.id)).toEqual(['a', 'b']);
    s = reduce(s, { type: 'undo' });
    expect(activeOps(s).map((o) => o.id)).toEqual(['a']);
    expect(s.ops).toHaveLength(2);
    s = reduce(s, { type: 'redo' });
    expect(activeOps(s).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('a new op after undo drops the redo tail', () => {
    const s = run(
      emptySession('/x.html', 'file'),
      { type: 'addOp', op: op('a') },
      { type: 'addOp', op: op('b') },
      { type: 'undo' },
      { type: 'addOp', op: op('c') },
    );
    expect(s.ops.map((o) => o.id)).toEqual(['a', 'c']);
    expect(s.undoPointer).toBe(2);
  });

  it('undo at the start is a no-op that returns the same object', () => {
    const s = emptySession('/x.html', 'file');
    expect(reduce(s, { type: 'undo' })).toBe(s);
  });
});

describe('rounds', () => {
  it('send → result → finish → review', () => {
    let s = run(
      emptySession('/x.html', 'file'),
      { type: 'addOp', op: op('a') },
      { type: 'addOp', op: op('b') },
      { type: 'undo' }, // b is not sent
      { type: 'addComment', comment: comment('c1') },
    );
    expect(pendingCount(s)).toBe(2);
    s = reduce(s, { type: 'send', at: 1 });
    const r = s.rounds[0];
    expect(r.n).toBe(1);
    expect(r.status).toBe('submitted');
    expect(r.ops.map((o) => o.id)).toEqual(['a']);
    expect(s.ops.map((o) => o.id)).toEqual(['a']); // redo tail dropped on send
    expect(s.comments[0].status).toBe('sent');
    expect(reduce(s, { type: 'send', at: 2 })).toBe(s); // one round at a time

    s = run(
      s,
      { type: 'result', round: 1, result: { item: 'a', state: 'applied', note: 'Pay is green in style.css' } },
      { type: 'result', round: 1, result: { item: 'c1', state: 'applied', note: 'Done' } },
      { type: 'finish', round: 1 },
    );
    expect(s.rounds[0].status).toBe('applied');
    expect(s.ops).toEqual([]); // applied ops are now in the code
    expect(s.undoPointer).toBe(0);
    expect(s.comments[0].status).toBe('applied');
    expect(s.comments[0].replies[0]).toMatchObject({ author: 'claude', body: 'Done' });

    s = run(s, { type: 'review', round: 1, item: 'a', verdict: 'confirmed', at: 3 });
    expect(s.rounds[0].status).toBe('applied');
    s = run(s, { type: 'review', round: 1, item: 'c1', verdict: 'reopened', note: 'Darker green', at: 4 });
    expect(s.rounds[0].status).toBe('confirmed');
    expect(s.comments[0].status).toBe('open');
    expect(s.comments[0].replies.at(-1)).toMatchObject({ author: 'you', body: 'Darker green' });
  });

  it('questions come back open, and reopened ops become change requests', () => {
    let s = run(
      emptySession('/x.html', 'file'),
      { type: 'addOp', op: op('a', { kind: 'move', label: 'Moved button' }) },
      { type: 'addComment', comment: comment('c1') },
      { type: 'send', at: 1 },
      { type: 'result', round: 1, result: { item: 'c1', state: 'question', note: 'Which green?' } },
      { type: 'finish', round: 1 },
    );
    expect(s.comments.find((c) => c.id === 'c1')?.status).toBe('open');
    s = reduce(s, { type: 'confirmAll', round: 1 });
    expect(s.rounds[0].status).toBe('confirmed');

    let t = run(
      emptySession('/x.html', 'file'),
      { type: 'addOp', op: op('m', { kind: 'move', label: 'Moved button' }) },
      { type: 'send', at: 1 },
      { type: 'finish', round: 1 },
      { type: 'review', round: 1, item: 'm', verdict: 'reopened', note: 'Still crooked', at: 2 },
    );
    expect(t.comments).toHaveLength(1);
    expect(t.comments[0]).toMatchObject({ type: 'change-request', status: 'open' });
    expect(t.comments[0].body).toContain('Still crooked');
  });

  it('ops already sent cannot be undone while Claude works', () => {
    const s = run(emptySession('/x.html', 'file'), { type: 'addOp', op: op('a') }, { type: 'send', at: 1 });
    expect(canUndo(s)).toBe(false);
    expect(reduce(s, { type: 'undo' })).toBe(s);
    const t = reduce(s, { type: 'addOp', op: op('b') });
    expect(canUndo(t)).toBe(true); // a new edit for the next round is fine
  });

  it('deleting a slide removes its ops and comments and fixes the pointer', () => {
    const s = run(
      emptySession('/x.html', 'file'),
      { type: 'addSlide', slide: { id: 's2', url: '/b.html', label: 'B', parent: 's1', path: [] } },
      { type: 'addOp', op: op('a') },
      { type: 'addOp', op: op('b', { slide: 's2' }) },
      { type: 'addComment', comment: comment('c', { slide: 's2' }) },
      { type: 'deleteSlide', id: 's2' },
    );
    expect(s.slides.map((x) => x.id)).toEqual(['s1']);
    expect(s.ops.map((o) => o.id)).toEqual(['a']);
    expect(s.undoPointer).toBe(1);
    expect(s.comments).toEqual([]);
  });
});
