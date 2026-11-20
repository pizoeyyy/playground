import { useSyncExternalStore } from 'react';
import { activeOps, canUndo, newId, reduce } from '../shared/session.ts';
import { PG, type ElementInfo, type FromAgent, type Mode, type Rect, type ToAgent } from '../shared/protocol.ts';
import type { ComponentKind } from '../shared/components.ts';
import type { Action, CommentType, Op, Session, Slide, Step } from '../shared/types.ts';

export type Device = 'desktop' | 'tablet' | 'mobile';
export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 768, mobile: 390 };

export type Composer = { kind: CommentType; selector: string; element: string; rect: Rect; slide: string };
export type Menu = Extract<FromAgent, { type: 'menu' }>;

export type State = {
  session: Session | null;
  frameOrigin: string;
  current: string; // slide id
  frameKey: number; // bump to reload the iframe
  frameUrl: string; // path loaded into the iframe
  mode: Mode;
  addKind: ComponentKind;
  palette: boolean;
  grid: boolean;
  gridSize: number;
  device: Device;
  selected: ElementInfo | null;
  composer: Composer | null;
  menu: Menu | null;
  openThread: string | null;
  rects: Record<string, Rect | null>;
  tab: 'inspect' | 'comments';
  sending: boolean;
  compare: number | null; // round number being compared
  toast: string | null;
  reloadLoop: boolean; // the page reloaded itself repeatedly; live reload + thumbnails paused
  zoom: number; // stage scale, so handles and snapping stay a usable size on screen
};

let state: State = {
  session: null,
  frameOrigin: '',
  current: 's1',
  frameKey: 0,
  frameUrl: '/',
  mode: 'select',
  addKind: 'button',
  palette: false,
  grid: false,
  gridSize: 8,
  device: 'desktop',
  selected: null,
  composer: null,
  menu: null,
  openThread: null,
  rects: {},
  tab: 'inspect',
  sending: false,
  compare: null,
  toast: null,
  reloadLoop: false,
  zoom: 1,
};

const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  for (const l of listeners) l();
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

// ---------- server ----------

// Server sessions that arrive while our own actions are still in flight are held back and applied
// once they've all landed. Applying them right away could briefly drop a slide we had just added,
// which used to bounce the page back to slide 1 (and, on pages that redirect, over and over).
let inflight = 0;
let heldServer: Session | null = null;

/** Apply locally (optimistic) and on the server (authoritative). */
export function act(a: Action) {
  const s = state.session;
  if (s) setState({ session: reduce(s, a) });
  inflight++;
  fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) })
    .then((r) => r.json() as Promise<{ session?: Session }>)
    .then((body) => body.session && hold(body.session))
    .catch(() => toast('Lost connection to the playground server'))
    .finally(() => {
      inflight--;
      flushServer();
    });
}

function hold(next: Session) {
  if (!heldServer || next.rev >= heldServer.rev) heldServer = next;
}

function flushServer() {
  if (inflight > 0 || !heldServer) return;
  const next = heldServer;
  heldServer = null;
  applyServer(next);
}

let toastTimer = 0;
export function toast(msg: string) {
  setState({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setState({ toast: null }), 2600);
}

export async function connect() {
  const r = await fetch('/api/session');
  const { session, frameOrigin } = (await r.json()) as { session: Session; frameOrigin: string };
  const first = session.slides[0];
  setState({ session, frameOrigin, current: first.id, frameUrl: first.url });
  const es = new EventSource('/api/events');
  es.addEventListener('session', (e) => onServerSession(JSON.parse((e as MessageEvent).data)));
  es.addEventListener('reload', () => {
    if (state.session?.rounds.some((r) => r.status === 'submitted')) return; // Claude is mid-edit
    if (state.reloadLoop) return; // paused by the loop guard
    reloadFrame();
  });
}

function onServerSession(next: Session) {
  hold(next);
  flushServer();
}

function applyServer(next: Session) {
  const prev = state.session;
  setState({ session: next });
  // A round Claude just finished: show the revised page.
  const finished = next.rounds.find((r) => r.status === 'applied' && prev?.rounds.find((p) => p.n === r.n)?.status === 'submitted');
  if (finished) {
    reloadFrame();
    toast(`Revision ${finished.n} is ready to review`);
    setState({ tab: 'comments' });
  }
  if (!next.slides.some((s) => s.id === state.current)) loadSlide(next.slides[0].id);
}

// ---------- the page iframe ----------

let iframe: HTMLIFrameElement | null = null;
let agentReady = false; // false while the iframe is (re)loading; messages then have nowhere to go
export const setIframe = (el: HTMLIFrameElement | null): void => {
  iframe = el;
  agentReady = false;
};

export function toAgent(m: ToAgent) {
  if (!agentReady) return;
  iframe?.contentWindow?.postMessage({ [PG]: 1, ...m }, state.frameOrigin);
}

// ---------- reload-loop guard ----------
// A page that keeps reloading itself (a file watcher reacting to something, a redirect loop)
// gets live reload and thumbnails paused, with a banner, instead of spinning forever.
let expectLoadUntil = 0;
const unexpectedLoads: number[] = [];
const expectLoad = () => (expectLoadUntil = Date.now() + 5000);

function noteLoad() {
  const now = Date.now();
  if (now < expectLoadUntil || (pendingClick && now - pendingClick.at < 4000)) return;
  unexpectedLoads.push(now);
  while (unexpectedLoads.length && now - unexpectedLoads[0] > 10000) unexpectedLoads.shift();
  if (unexpectedLoads.length >= 4 && !state.reloadLoop) {
    setState({ reloadLoop: true });
    toAgent({ type: 'thumbs', on: false });
  }
}

export function resumeAfterLoop() {
  unexpectedLoads.length = 0;
  setState({ reloadLoop: false });
  toAgent({ type: 'thumbs', on: true });
}

export const currentSlide = (): Slide | undefined => state.session?.slides.find((s) => s.id === state.current);
const slideOps = (id: string): Op[] => (state.session ? activeOps(state.session).filter((o) => o.slide === id) : []);
const slidePins = (id: string): string[] =>
  state.session?.comments.filter((c) => c.slide === id && c.status !== 'resolved').map((c) => c.selector) ?? [];

export function initAgent() {
  toAgent({
    type: 'init',
    ops: slideOps(state.current),
    mode: state.mode,
    addKind: state.addKind,
    grid: state.grid,
    gridSize: state.gridSize,
    pins: slidePins(state.current),
    thumbs: !state.reloadLoop,
    zoom: state.zoom,
  });
}

export const syncPins = () => toAgent({ type: 'pins', selectors: slidePins(state.current) });

let pendingClick: { step: Step; at: number } | null = null;
let pendingReplay: { parentId: string; path: Step[] } | null = null;

export function reloadFrame() {
  expectLoad();
  const sl = currentSlide();
  setState((s) => ({ frameKey: s.frameKey + 1, frameUrl: sl?.url ?? '/', selected: null, rects: {} }));
}

export function loadSlide(id: string) {
  const sl = state.session?.slides.find((s) => s.id === id);
  if (!sl) return;
  pendingClick = null;
  expectLoad();
  setState((s) => ({
    current: id,
    frameUrl: sl.url,
    frameKey: s.frameKey + 1,
    selected: null,
    composer: null,
    menu: null,
    openThread: null,
    rects: {},
  }));
}

/** Reach a slide by loading its parent and replaying the recorded clicks. */
export function replaySlide(id: string) {
  const sl = state.session?.slides.find((s) => s.id === id);
  if (!sl?.parent || !sl.path.length) return loadSlide(id);
  pendingReplay = { parentId: sl.parent, path: sl.path };
  loadSlide(sl.parent);
}

function labelFor(url: string, title: string): string {
  const u = new URL(url, 'http://x');
  const v = u.searchParams.get('v');
  const name = u.pathname.split('/').filter(Boolean).pop()?.replace(/\.html?$/, '').replace(/[-_]/g, ' ');
  if (name && name !== 'index') return name.charAt(0).toUpperCase() + name.slice(1) + (v ? ` · v${v}` : '');
  if (v) return `Variant ${v}`;
  if (u.hash.length > 1) return u.hash.slice(1);
  return title || 'Page';
}

/** The page changed URL. Decide whether that's the same slide, an existing one, or a new one. */
function onNavigated(url: string, kind: 'load' | 'push' | 'replace' | 'pop' | 'hash', title = '') {
  const s = state.session;
  if (!s) return;
  const cur = currentSlide();
  if (cur?.url === url) return;
  const click = pendingClick && Date.now() - pendingClick.at < 4000 ? pendingClick : null;
  const existing = s.slides.find((x) => x.url === url);
  if (existing) {
    setState({ current: existing.id, selected: null, composer: null, rects: {} });
    pendingClick = null;
    return;
  }
  // A URL change nobody clicked for (redirect, a page tidying its own URL) belongs to this slide.
  if (!click && kind !== 'push' && kind !== 'pop' && cur) {
    act({ type: 'updateSlide', id: cur.id, patch: { url } });
    return;
  }
  const n = s.slides.length + 1;
  const id = newId('s').replace(/[^a-z0-9]/gi, '');
  act({
    type: 'addSlide',
    slide: { id, url, label: labelFor(url, title), parent: cur?.id ?? null, path: click ? [click.step] : [] },
  });
  pendingClick = null;
  setState({ current: id, selected: null, composer: null, rects: {} });
  toast(`Slide ${n} added`);
}

let thumbWaiter: (() => void) | null = null;

export function onAgentMessage(e: MessageEvent) {
  if (e.origin !== state.frameOrigin || !e.data?.[PG]) return;
  const m = e.data as FromAgent;
  switch (m.type) {
    case 'ready': {
      agentReady = true;
      noteLoad();
      onNavigated(m.url, 'load', m.title);
      initAgent();
      if (pendingReplay && pendingReplay.parentId === state.current) {
        const path = pendingReplay.path;
        pendingReplay = null;
        toAgent({ type: 'replay', path });
      }
      break;
    }
    case 'nav': {
      const before = state.current;
      onNavigated(m.url, m.kind);
      if (state.current !== before) initAgent();
      break;
    }
    case 'clicked':
      pendingClick = { step: m.step, at: Date.now() };
      break;
    case 'selected':
      setState({ selected: m.info });
      break;
    case 'op': {
      const s = state.session;
      if (!s) break;
      const known = activeOps(s).some((o) => o.id === m.op.id);
      if (known) act({ type: 'updateOp', id: m.op.id, patch: { ...m.op, at: Date.now() } });
      else act({ type: 'addOp', op: { ...m.op, slide: state.current, at: Date.now() } });
      break;
    }
    case 'compose':
      setState({
        composer: { kind: m.kind, selector: m.selector, element: m.element, rect: m.rect, slide: state.current },
        openThread: null,
      });
      break;
    case 'rects':
      setState({ rects: m.rects });
      break;
    case 'key':
      handleKey(m.key, m.ctrl, m.shift);
      break;
    case 'thumb':
      fetch('/api/thumb', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slide: state.current, dataUrl: m.dataUrl }),
      }).finally(() => {
        thumbWaiter?.();
        thumbWaiter = null;
      });
      break;
    case 'mode':
      setState({ mode: m.mode });
      break;
    case 'menu':
      setState({ menu: m, composer: null, openThread: null });
      break;
    case 'added':
      toast(`Added a ${m.kind}. Right-click it → Describe behavior to say what it does.`);
      break;
    case 'dismiss':
      setState({ menu: null });
      break;
  }
}

export function closeMenu() {
  if (!state.menu) return;
  setState({ menu: null });
  toAgent({ type: 'menuClosed' });
}

// ---------- commands ----------

export function setMode(mode: Mode) {
  setState({ mode, palette: false });
  toAgent({ type: 'mode', mode });
}

/** Pick a component from the palette; the next click on the page drops it there. */
export function startAdd(kind: ComponentKind) {
  setState({ mode: 'add', addKind: kind, palette: false });
  toAgent({ type: 'mode', mode: 'add', addKind: kind });
}

export function toggleGrid() {
  const grid = !state.grid;
  setState({ grid });
  toAgent({ type: 'grid', show: grid, size: state.gridSize });
}

function slideName(id: string) {
  const i = state.session?.slides.findIndex((s) => s.id === id) ?? -1;
  return i >= 0 ? `slide ${i + 1}` : 'another slide';
}

export function undo() {
  const s = state.session;
  if (!s || s.undoPointer === 0) return;
  if (!canUndo(s)) return toast('That edit was already sent to Claude. Reopen it in review instead.');
  const op = s.ops[s.undoPointer - 1];
  act({ type: 'undo' });
  if (op.slide === state.current) toAgent({ type: 'revert', op });
  else toast(`Undid "${op.label}" on ${slideName(op.slide)}`);
}

export function redo() {
  const s = state.session;
  if (!s || s.undoPointer >= s.ops.length) return;
  const op = s.ops[s.undoPointer];
  act({ type: 'redo' });
  if (op.slide === state.current) toAgent({ type: 'apply', op });
  else toast(`Redid "${op.label}" on ${slideName(op.slide)}`);
}

export async function saveAndSend() {
  if (state.sending) return;
  setState({ sending: true });
  // Fresh "before" image of the slide on screen.
  await new Promise<void>((resolve) => {
    thumbWaiter = resolve;
    toAgent({ type: 'capture' });
    setTimeout(resolve, 3000);
  });
  try {
    const r = await fetch('/api/send', { method: 'POST' });
    const body = (await r.json()) as { session?: Session; error?: string };
    if (body.session) onServerSession(body.session);
    if (!r.ok) toast(body.error ?? 'Could not send');
    else toast('Sent to Claude');
  } finally {
    setState({ sending: false });
  }
}

export function addComment(kind: CommentType, body: string) {
  const c = state.composer;
  if (!c || !body.trim()) return;
  act({
    type: 'addComment',
    comment: {
      id: newId('c'),
      slide: c.slide,
      selector: c.selector,
      element: c.element,
      type: kind,
      body: body.trim(),
      status: 'open',
      replies: [],
      at: Date.now(),
    },
  });
  setState({ composer: null });
  queueMicrotask(syncPins);
}

export function focusComment(id: string) {
  const c = state.session?.comments.find((x) => x.id === id);
  if (!c) return;
  if (c.slide !== state.current) {
    loadSlide(c.slide);
    setTimeout(() => toAgent({ type: 'select', selector: c.selector, scroll: true }), 600);
  } else toAgent({ type: 'select', selector: c.selector, scroll: true });
  setState({ openThread: id, composer: null });
}

export function openComposer(kind: CommentType) {
  const sel = state.selected;
  if (!sel) return toast('Select an element first');
  setState({ composer: { kind, selector: sel.selector, element: sel.element, rect: sel.rect, slide: state.current } });
}

const typingInEditor = () => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
};

export function handleKey(key: string, ctrl: boolean, shift: boolean) {
  const k = key.toLowerCase();
  if (ctrl && k === 'z') return shift ? redo() : undo();
  if (ctrl && k === 'y') return redo();
  if (ctrl && k === 'enter') return saveAndSend();
  if (ctrl) return;
  if (key === 'Escape') {
    if (state.menu) return closeMenu();
    if (state.palette) return setState({ palette: false });
    if (state.composer || state.openThread) return setState({ composer: null, openThread: null });
    if (state.mode !== 'select') return setMode('select');
    return toAgent({ type: 'select', selector: null });
  }
  if (k === 'v') setMode('select');
  else if (k === 'i') setMode('interact');
  else if (k === 'b') startAdd('button');
  else if (k === 'a') setState({ palette: !state.palette });
  else if (k === 'c') setMode('comment');
  else if (key === "'") toggleGrid();
}

export function onEditorKey(e: KeyboardEvent) {
  if (typingInEditor()) {
    if (e.key === 'Escape') (document.activeElement as HTMLElement).blur();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !/^[zy]$|^enter$/i.test(e.key)) return;
  handleKey(e.key, ctrl, e.shiftKey);
  if (ctrl || e.key.length === 1 || e.key === 'Escape') e.preventDefault();
}
