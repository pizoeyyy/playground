import type { Action, Comment, Op, Round, Session } from './types.ts';

export function emptySession(target: string, targetKind: 'file' | 'url'): Session {
  return {
    version: 1,
    target,
    targetKind,
    slides: [{ id: 's1', url: '/', label: 'Slide 1', parent: null, path: [] }],
    ops: [],
    undoPointer: 0,
    comments: [],
    rounds: [],
    rev: 0,
  };
}

export const activeOps = (s: Session): Op[] => s.ops.slice(0, s.undoPointer);

export const pendingCount = (s: Session): number =>
  activeOps(s).length + s.comments.filter((c) => c.status === 'open').length;

export const openRound = (s: Session): Round | undefined =>
  s.rounds.find((r) => r.status === 'submitted');

export const latestRound = (s: Session): Round | undefined => s.rounds[s.rounds.length - 1];

export function newId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Ops already sent to Claude can't be undone in the editor; reopen them in review instead. */
export function canUndo(s: Session): boolean {
  if (s.undoPointer === 0) return false;
  const last = s.ops[s.undoPointer - 1];
  return !openRound(s)?.ops.some((o) => o.id === last.id);
}

/** Every item id in a round, ops first. */
export const roundItems = (r: Round): (Op | Comment)[] => [...r.ops, ...r.comments];

/** Pure reducer. Returns the same object when nothing changed. */
export function reduce(s: Session, a: Action): Session {
  const next = apply(structuredClone(s), a);
  if (next === null) return s;
  next.rev = s.rev + 1;
  return next;
}

function apply(s: Session, a: Action): Session | null {
  switch (a.type) {
    case 'addSlide':
      if (s.slides.some((x) => x.id === a.slide.id)) return null;
      s.slides.push(a.slide);
      return s;
    case 'updateSlide': {
      const slide = s.slides.find((x) => x.id === a.id);
      if (!slide) return null;
      Object.assign(slide, a.patch);
      return s;
    }
    case 'deleteSlide': {
      if (s.slides.length <= 1) return null;
      s.slides = s.slides.filter((x) => x.id !== a.id);
      for (const x of s.slides) if (x.parent === a.id) x.parent = null;
      const keep = (o: { slide: string }) => o.slide !== a.id;
      const before = activeOps(s);
      s.ops = s.ops.filter(keep);
      s.undoPointer = before.filter(keep).length;
      s.comments = s.comments.filter(keep);
      return s;
    }
    case 'addOp':
      s.ops = activeOps(s); // a new op drops the redo tail
      s.ops.push(a.op);
      s.undoPointer = s.ops.length;
      return s;
    case 'updateOp': {
      const op = s.ops.find((o) => o.id === a.id);
      if (!op) return null;
      Object.assign(op, a.patch);
      return s;
    }
    case 'undo':
      if (!canUndo(s)) return null;
      s.undoPointer -= 1;
      return s;
    case 'redo':
      if (s.undoPointer >= s.ops.length) return null;
      s.undoPointer += 1;
      return s;
    case 'addComment':
      s.comments.push(a.comment);
      return s;
    case 'reply': {
      const c = s.comments.find((x) => x.id === a.id);
      if (!c) return null;
      c.replies.push(a.reply);
      return s;
    }
    case 'setCommentStatus': {
      const c = s.comments.find((x) => x.id === a.id);
      if (!c) return null;
      c.status = a.status;
      return s;
    }
    case 'deleteComment':
      s.comments = s.comments.filter((x) => x.id !== a.id);
      return s;
    case 'send': {
      if (openRound(s)) return null; // one round in flight at a time
      const ops = activeOps(s);
      const comments = s.comments.filter((c) => c.status === 'open');
      if (ops.length === 0 && comments.length === 0) return null;
      for (const c of comments) c.status = 'sent';
      s.ops = ops;
      s.undoPointer = ops.length;
      const n = s.rounds.reduce((m, r) => Math.max(m, r.n), 0) + 1;
      s.rounds.push({
        n,
        status: 'submitted',
        at: a.at,
        ops: structuredClone(ops),
        comments: structuredClone(comments),
        results: [],
        review: {},
        shots: {},
      });
      return s;
    }
    case 'result': {
      const r = s.rounds.find((x) => x.n === a.round);
      if (!r) return null;
      r.results = r.results.filter((x) => x.item !== a.result.item);
      r.results.push(a.result);
      return s;
    }
    case 'finish': {
      const r = s.rounds.find((x) => x.n === a.round);
      if (!r || r.status !== 'submitted') return null;
      r.status = 'applied';
      // The round's ops are now in the source code; stop replaying them.
      const sent = new Set(r.ops.map((o) => o.id));
      const active = activeOps(s).filter((o) => !sent.has(o.id));
      s.ops = [...active, ...s.ops.slice(s.undoPointer).filter((o) => !sent.has(o.id))];
      s.undoPointer = active.length;
      for (const rc of r.comments) {
        const c = s.comments.find((x) => x.id === rc.id);
        if (!c) continue;
        const res = r.results.find((x) => x.item === rc.id);
        if (res) c.replies.push({ author: 'claude', body: res.note, at: Date.now() });
        c.status = res?.state === 'question' ? 'open' : 'applied';
      }
      // Questions about ops come back as open change requests so they stay visible.
      for (const op of r.ops) {
        const res = r.results.find((x) => x.item === op.id);
        if (res?.state === 'question') {
          s.comments.push({
            id: newId('c'),
            slide: op.slide,
            selector: op.selector,
            element: op.element,
            type: 'change-request',
            body: `${op.label}`,
            status: 'open',
            replies: [{ author: 'claude', body: res.note, at: Date.now() }],
            at: Date.now(),
          });
        }
      }
      return s;
    }
    case 'setShots': {
      const r = s.rounds.find((x) => x.n === a.round);
      if (!r) return null;
      r.shots = { ...r.shots, ...a.shots };
      return s;
    }
    case 'review': {
      const r = s.rounds.find((x) => x.n === a.round);
      if (!r || r.status === 'submitted') return null;
      reviewItem(s, r, a.item, a.verdict, a.note, a.at);
      closeIfReviewed(r);
      return s;
    }
    case 'confirmAll': {
      const r = s.rounds.find((x) => x.n === a.round);
      if (!r || r.status !== 'applied') return null;
      for (const item of roundItems(r)) {
        if (!r.review[item.id]) reviewItem(s, r, item.id, 'confirmed', undefined, Date.now());
      }
      closeIfReviewed(r);
      return s;
    }
  }
}

function reviewItem(s: Session, r: Round, item: string, verdict: 'confirmed' | 'reopened', note: string | undefined, at: number) {
  r.review[item] = { verdict, note };
  const c = s.comments.find((x) => x.id === item);
  if (c) {
    if (verdict === 'confirmed') c.status = 'resolved';
    else {
      c.status = 'open';
      if (note) c.replies.push({ author: 'you', body: note, at });
    }
    return;
  }
  const op = r.ops.find((o) => o.id === item);
  if (op && verdict === 'reopened') {
    s.comments.push({
      id: newId('c'),
      slide: op.slide,
      selector: op.selector,
      element: op.element,
      type: 'change-request',
      body: `Reopened: ${op.label}${note ? ` — ${note}` : ''}`,
      status: 'open',
      replies: [],
      at,
    });
  }
}

function closeIfReviewed(r: Round) {
  if (roundItems(r).every((i) => r.review[i.id])) r.status = 'confirmed';
}
