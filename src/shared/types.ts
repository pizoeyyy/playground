// Data model shared by the server, the editor, the in-page agent and the CLI.
// `.playground/session.json` is exactly a `Session`.

export type Step = { selector: string; text: string };

export type Slide = {
  id: string;
  url: string; // path + search + hash on the frame origin, e.g. "/checkout.html?v=2"
  label: string;
  parent: string | null;
  path: Step[]; // clicks on the parent slide that led here
  thumb?: string; // served URL of the latest thumbnail
  frozen?: FrozenInfo; // a static copy of another slide, saved when a comment was made on it
};

export type FrozenInfo = {
  from: string; // the live slide it was copied from
  url: string; // the live page's URL at the time
  version: number; // the live page's change counter at the time (comments on an unchanged page share a copy)
  loadId: string; // which page load that counter belongs to
  at: number;
};

export type Neighbour = { selector: string; text: string; relation: string };

export type InsertSpec = {
  kind?: string; // component kind, e.g. "card"
  html: string; // outerHTML of the new element, carries data-pg-id
  ref: string; // selector of the reference element
  position: 'after' | 'append';
};

export type OpKind = 'style' | 'text' | 'move' | 'resize' | 'insert' | 'delete' | 'duplicate';

export type Op = {
  id: string;
  slide: string;
  kind: OpKind;
  selector: string; // element the op acts on (for insert/duplicate: the new element)
  element: string; // human description, e.g. 'button "Buy now"'
  label: string; // human description of the change
  prop?: string; // style: CSS property; move: "translate"; delete: "display"
  before?: string; // computed/visible value before (for people and Claude)
  after?: string;
  beforeInline?: string; // exact inline value to restore on undo (resize: JSON of width/height/translate)
  afterTranslate?: string; // resize: keeps the anchored edge still
  insert?: InsertSpec;
  neighbours?: Neighbour[];
  coalesce?: boolean; // may merge with an immediately preceding op on the same target
  at: number;
};

export type Reply = { author: 'you' | 'claude'; body: string; at: number };

/** `behavior` describes what something should do when used ("on click, open the confirm popup"). */
export type CommentType = 'comment' | 'change-request' | 'behavior';

export const COMMENT_LABEL: Record<CommentType, string> = {
  comment: 'Comment',
  'change-request': 'Change request',
  behavior: 'Behavior',
};
export type CommentStatus = 'open' | 'sent' | 'applied' | 'resolved' | 'undone';

export type Comment = {
  id: string;
  slide: string; // where it is pinned (a frozen copy when made on a live page)
  live?: string; // the live slide it was made on, where its pin also shows while the element is there
  selector: string;
  element: string;
  type: CommentType;
  body: string;
  status: CommentStatus;
  replies: Reply[];
  at: number;
};

export type ResultState = 'applied' | 'question';
export type Result = {
  item: string;
  state: ResultState;
  note: string;
  patch?: string; // id of the recorded file changes (patches/<id>.json), for exact undo
  linked?: string[]; // items built together and sharing that patch
};
export type Verdict = 'confirmed' | 'reopened' | 'undone';

/** A request to undo one applied item, handed to Claude when an exact undo isn't possible. */
export type UndoItem = {
  id: string;
  round: number; // round the change was applied in
  item: string; // that round's item id
  label: string; // what the item was
  note: string; // Claude's note from when it applied it
  patch?: string; // recorded file changes, if any
  reason: string; // why the exact undo didn't happen
};

export type Round = {
  n: number;
  status: 'submitted' | 'applied' | 'confirmed';
  at: number;
  ops: Op[];
  comments: Comment[];
  results: Result[];
  review: Record<string, { verdict: Verdict; note?: string }>;
  shots: Record<string, string>; // slide id -> served URL of the "before" image
  undo?: UndoItem[]; // undo requests Claude handles in this round
};

export type Session = {
  version: 1;
  target: string;
  targetKind: 'file' | 'url';
  root?: string; // project folder the source lives in (file target: its folder)
  slides: Slide[];
  ops: Op[];
  undoPointer: number; // ops[0..undoPointer) are active, the rest are redo-able
  comments: Comment[];
  rounds: Round[];
  pendingUndo?: UndoItem[]; // waiting for the round in flight to finish
  rev: number; // bumped on every change
};

export type Action =
  | { type: 'addSlide'; slide: Slide }
  | { type: 'updateSlide'; id: string; patch: Partial<Slide> }
  | { type: 'deleteSlide'; id: string }
  | { type: 'addOp'; op: Op }
  | { type: 'updateOp'; id: string; patch: Partial<Op> }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'addComment'; comment: Comment }
  | { type: 'reply'; id: string; reply: Reply }
  | { type: 'setCommentStatus'; id: string; status: CommentStatus }
  | { type: 'deleteComment'; id: string }
  | { type: 'send'; at: number }
  | { type: 'result'; round: number; result: Result }
  | { type: 'finish'; round: number }
  | { type: 'setShots'; round: number; shots: Record<string, string> }
  | { type: 'markUndone'; round: number; item: string; note: string; at: number }
  | { type: 'requestUndo'; undo: UndoItem; at: number }
  | { type: 'review'; round: number; item: string; verdict: Verdict; note?: string; at: number }
  | { type: 'confirmAll'; round: number };
