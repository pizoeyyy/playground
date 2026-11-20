// Injected into every HTML page the playground serves. Runs only when the page is
// framed directly by the editor. Talks to the editor over postMessage.
import { finder } from '@medv/finder';
import { domToJpeg } from 'modern-screenshot';
import { PG, type AgentOp, type ElementInfo, type FromAgent, type Mode, type Rect, type ToAgent } from '../shared/protocol.ts';
import { componentLabel, type ComponentKind } from '../shared/components.ts';
import type { CommentType, Neighbour, Op, Step } from '../shared/types.ts';
import { OVERLAY_CSS } from './overlay-css.ts';

const script = document.currentScript as HTMLScriptElement | null;
const EDITOR = script ? new URL(script.src).searchParams.get('editor') ?? '' : '';

if (EDITOR && window.parent !== window && window.parent === window.top) boot();

function boot() {
  // ---------- state ----------
  let mode: Mode = 'select';
  let addKind: ComponentKind = 'button';
  let gridOn = false;
  let gridSize = 8;
  let selected: Element | null = null;
  let hovered: Element | null = null;
  let editing: HTMLElement | null = null;
  let passthrough = false;
  let pins: string[] = [];
  let lastRects = '';
  const applied = new Map<string, Op>(); // op id -> op currently applied in the DOM
  const previews = new Map<string, { inline: string; computed: string }>();

  const post = (m: FromAgent) => window.parent.postMessage({ [PG]: 1, ...m }, EDITOR);
  const here = () => location.pathname + location.search + location.hash;
  const newId = (p: string) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // ---------- navigation (patched before the page's own scripts run) ----------
  for (const k of ['pushState', 'replaceState'] as const) {
    const orig = history[k].bind(history);
    history[k] = function (...args: Parameters<History['pushState']>) {
      const before = here();
      const r = orig(...args);
      if (here() !== before) post({ type: 'nav', url: here(), kind: k === 'pushState' ? 'push' : 'replace' });
      return r;
    } as History['pushState'];
  }
  addEventListener('popstate', () => post({ type: 'nav', url: here(), kind: 'pop' }));
  addEventListener('hashchange', () => post({ type: 'nav', url: here(), kind: 'hash' }));
  post({ type: 'ready', url: here(), title: document.title });

  // ---------- helpers ----------
  const q = (s: string): Element | null => {
    try {
      return document.querySelector(s);
    } catch {
      return null;
    }
  };

  const okClass = (n: string) => !/^(pg-|css-|sc-|jsx-|_)/.test(n) && !/[0-9a-f]{5,}|\d{3,}/i.test(n) && n.length < 40;
  const okId = (n: string) => !/\d{3,}|^:|[0-9a-f]{8,}/i.test(n);
  function selectorOf(el: Element): string {
    const pg = el.getAttribute('data-pg-id');
    if (pg) return `[data-pg-id="${pg}"]`;
    if (el === document.body) return 'body';
    if (el === document.documentElement) return 'html';
    try {
      return finder(el, { root: document.body, className: okClass, idName: okId, timeoutMs: 400 });
    } catch {
      const parts: string[] = [];
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const i = e.parentElement ? [...e.parentElement.children].indexOf(e) + 1 : 1;
        parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${i})`);
      }
      return ['body', ...parts].join(' > ');
    }
  }

  function describe(el: Element): string {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    const raw =
      el.getAttribute('aria-label') ||
      (el as HTMLElement).innerText ||
      el.getAttribute('alt') ||
      el.getAttribute('placeholder') ||
      (el as HTMLInputElement).value ||
      '';
    const text = String(raw).trim().replace(/\s+/g, ' ').slice(0, 40);
    const pgKind = el.getAttribute('data-pg-kind');
    const kind = pgKind
      ? componentLabel(pgKind)
      : tag === 'a' ? 'link' : tag === 'button' || role === 'button' ? 'button' : tag === 'img' ? 'image' :
      tag === 'input' ? `${(el as HTMLInputElement).type || 'text'} input` : tag;
    if (text) return `${kind} "${text}"`;
    const cls = [...el.classList].find(okClass);
    return cls ? `${kind}.${cls}` : kind;
  }

  const INTERACTIVE = 'a,button,[role=button],input,select,textarea,label,summary,[onclick]';
  function pick(target: EventTarget | null): Element | null {
    let el = target instanceof Element ? target : null;
    if (!el) return null;
    const svg = el.closest('svg');
    if (svg) el = svg;
    const inter = el.closest(INTERACTIVE);
    if (inter && inter !== el && depth(inter, el) <= 3) el = inter;
    return el;
  }
  const depth = (anc: Element, el: Element) => {
    let d = 0;
    for (let e: Element | null = el; e && e !== anc; e = e.parentElement) d++;
    return d;
  };

  function textNodeOf(el: Element): Text | null {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue?.trim()) return n as Text;
    return null;
  }
  function getText(el: Element): string | null {
    if (['INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'SVG', 'VIDEO'].includes(el.tagName.toUpperCase())) return null;
    if (el.children.length === 0) return el.textContent ?? '';
    const t = textNodeOf(el);
    return t && el.querySelectorAll('*').length <= 4 ? (t.nodeValue ?? '').trim() : null;
  }
  function setText(el: Element, value: string) {
    if (el.children.length === 0) el.textContent = value;
    else {
      const t = textNodeOf(el);
      if (t) t.nodeValue = value;
    }
  }

  const rectOf = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const parseTranslate = (v: string) => {
    const [x = '0', y = '0'] = v.trim().split(/\s+/);
    return { x: parseFloat(x) || 0, y: parseFloat(y) || 0 };
  };
  const inlineOf = (el: Element, prop: string) => {
    const s = (el as HTMLElement).style;
    const v = s.getPropertyValue(prop);
    return v ? `${v}|${s.getPropertyPriority(prop)}` : '';
  };
  const restoreInline = (el: Element, prop: string, saved: string | undefined) => {
    const s = (el as HTMLElement).style;
    if (!saved) s.removeProperty(prop);
    else {
      const [v, pri] = saved.split('|');
      s.setProperty(prop, v, pri);
    }
  };

  function info(el: Element): ElementInfo {
    const cs = getComputedStyle(el);
    return {
      selector: selectorOf(el),
      element: describe(el),
      tag: el.tagName.toLowerCase(),
      text: getText(el),
      rect: rectOf(el),
      styles: {
        color: cs.color,
        background: cs.backgroundColor,
        border: cs.borderTopColor,
        fontSize: cs.fontSize,
        radius: cs.borderTopLeftRadius,
      },
      translate: parseTranslate((el as HTMLElement).style.translate || ''),
    };
  }

  // ---------- overlay (shadow DOM, never part of the page) ----------
  const host = document.createElement('pg-overlay');
  host.setAttribute('style', 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:block;');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${OVERLAY_CSS}</style>
    <div class="grid"></div>
    <div class="box hover"></div>
    <div class="box sel"><span class="tag"></span></div>
    <div class="guides"></div>`;
  const $ = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
  const hoverBox = $('.hover');
  const selBox = $('.sel');
  const selTag = $('.tag');
  const guides = $('.guides');
  const gridEl = $('.grid');
  const cursorStyle = document.createElement('style');
  cursorStyle.id = 'pg-cursor';

  const mount = () => {
    document.documentElement.appendChild(host);
    (document.head ?? document.documentElement).appendChild(cursorStyle);
    applyMode();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();

  const isOurs = (e: Event) => e.composedPath().includes(host);

  function place(box: HTMLElement, el: Element | null) {
    if (!el || !el.isConnected) {
      box.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.transform = `translate(${r.left}px, ${r.top}px)`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
  }

  function frame() {
    place(hoverBox, mode === 'interact' || hovered === selected ? null : hovered);
    place(selBox, selected);
    if (gridOn) gridEl.style.backgroundPosition = `${-scrollX % gridSize}px ${-scrollY % gridSize}px`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function applyMode() {
    cursorStyle.textContent =
      mode === 'interact' ? '' : mode === 'select' ? '*{cursor:default !important}' : '*{cursor:crosshair !important}';
    if (mode === 'interact') hovered = null;
    gridEl.style.display = gridOn ? 'block' : 'none';
    gridEl.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  }

  function select(el: Element | null, scroll = false) {
    if (editing && el !== editing) editing.blur();
    selected = el;
    if (el) {
      selTag.textContent = describe(el);
      if (scroll) el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
    }
    post({ type: 'selected', info: el ? info(el) : null });
  }
  const refreshSelected = () => {
    if (!selected) return;
    selTag.textContent = describe(selected);
    post({ type: 'selected', info: info(selected) });
  };

  // ---------- ops ----------
  // Rapid repeats on the same target (arrow nudges, colour drags) merge into one undo step:
  // the op keeps the first one's id and "before", so one Ctrl+Z restores the original.
  let lastEmit: { op: AgentOp; at: number } | null = null;
  function mergeBase(selector: string, kind: string, prop: string | undefined) {
    const l = lastEmit;
    if (!l || !l.op.coalesce || Date.now() - l.at > 1500 || !applied.has(l.op.id)) return null;
    if (l.op.selector !== selector || l.op.kind !== kind || l.op.prop !== prop) return null;
    return { id: l.op.id, before: l.op.before, beforeInline: l.op.beforeInline };
  }

  function emit(op: AgentOp) {
    post({ type: 'op', op });
    applied.set(op.id, op as Op);
    lastEmit = { op, at: Date.now() };
    scheduleThumb();
    refreshSelected();
  }

  function applyOp(op: Op, force = false) {
    if (applied.has(op.id) && !force) return;
    if (op.kind === 'insert' || op.kind === 'duplicate') {
      if (!op.insert || q(op.selector)) return void applied.set(op.id, op);
      const ref = q(op.insert.ref);
      if (!ref) return;
      const t = document.createElement('template');
      t.innerHTML = op.insert.html;
      const node = t.content.firstElementChild;
      if (!node) return;
      if (op.insert.position === 'append') ref.appendChild(node);
      else ref.after(node);
      applied.set(op.id, op);
      return;
    }
    const el = q(op.selector);
    if (!el) return;
    if (op.kind === 'text') setText(el, op.after ?? '');
    else if (op.prop) (el as HTMLElement).style.setProperty(op.prop, op.after ?? '', op.kind === 'move' ? '' : 'important');
    applied.set(op.id, op);
  }

  function revertOp(op: Op) {
    applied.delete(op.id);
    const el = q(op.selector);
    if (!el) return;
    if (op.kind === 'insert' || op.kind === 'duplicate') {
      if (selected && (selected === el || el.contains(selected))) select(null);
      el.remove();
    } else if (op.kind === 'text') setText(el, op.before ?? '');
    else if (op.prop) restoreInline(el, op.prop, op.beforeInline);
  }

  function neighboursOf(el: Element): Neighbour[] {
    const parent = el.parentElement;
    if (!parent) return [];
    const me = el.getBoundingClientRect();
    const cx = me.left + me.width / 2;
    const cy = me.top + me.height / 2;
    const sibs = [...parent.children].filter((s) => s !== el && visible(s));
    return sibs
      .map((s) => {
        const r = s.getBoundingClientRect();
        const dx = cx - (r.left + r.width / 2);
        const dy = cy - (r.top + r.height / 2);
        const relation =
          Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right of' : 'left of') : dy > 0 ? 'below' : 'above';
        return { s, d: Math.hypot(dx, dy), relation };
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .map(({ s, relation }) => ({ selector: selectorOf(s), text: describe(s), relation }))
      .concat([{ selector: selectorOf(parent), text: describe(parent), relation: 'inside' }]);
  }

  /** Record a move. `el` must already be at `after`; `beforeInline` is the inline value to restore on undo. */
  function moveOp(el: Element, before: string, after: string, beforeInline: string, coalesce: boolean) {
    const selector = selectorOf(el);
    const merged = coalesce ? mergeBase(selector, 'move', 'translate') : null;
    if (merged) {
      before = merged.before ?? before;
      beforeInline = merged.beforeInline ?? '';
    }
    const a = parseTranslate(after);
    const b = parseTranslate(before);
    const dx = Math.round(a.x - b.x);
    const dy = Math.round(a.y - b.y);
    const dir = [dx && `${dx > 0 ? 'right' : 'left'} ${Math.abs(dx)}px`, dy && `${dy > 0 ? 'down' : 'up'} ${Math.abs(dy)}px`]
      .filter(Boolean)
      .join(', ');
    const neighbours = neighboursOf(el);
    const near = neighbours.find((n) => n.relation !== 'inside');
    emit({
      id: merged?.id ?? newId('o'),
      kind: 'move',
      selector,
      element: describe(el),
      label: `Moved ${describe(el)} ${dir || 'in place'}${near ? `, now ${near.relation} ${near.text}` : ''}`,
      prop: 'translate',
      before: before || '0px 0px',
      after,
      beforeInline,
      neighbours,
      coalesce,
    });
  }

  // Neutral look that sits fine on light pages; buttons copy the page's own button classes instead.
  const BORDER = '1px solid rgba(128,128,128,.3)';
  const BOX = `padding:16px;border:${BORDER};border-radius:12px;background:#fff;color:#1d1d1d;max-width:340px;box-sizing:border-box`;
  const FIELD = `height:40px;padding:0 12px;border:${BORDER};border-radius:8px;background:#fff;color:#1d1d1d;font:inherit;box-sizing:border-box`;
  const BTN = `height:36px;padding:0 14px;border:${BORDER};border-radius:8px;background:#fff;color:#1d1d1d;font:inherit;font-weight:600`;
  const BTN_PRIMARY = BTN.replace('background:#fff;color:#1d1d1d', 'background:#1d1d1d;color:#fff');

  function buildComponent(kind: ComponentKind, id: string, scope: Element): { html: string; editable: boolean } {
    const k = (inner: string, tag = 'div', style = '') =>
      `<${tag} data-pg-id="${id}" data-pg-kind="${kind}" style="${style}">${inner}</${tag}>`;
    switch (kind) {
      case 'card':
        return { editable: false, html: k('<h3 style="margin:0 0 4px;font-size:16px">Card title</h3><p style="margin:0;opacity:.7">A short description of what this card is about.</p>', 'div', BOX) };
      case 'dropdown':
        return { editable: false, html: k('<option>Option 1</option><option>Option 2</option><option>Option 3</option>', 'select', FIELD) };
      case 'menu':
        return {
          editable: false,
          html: k(
            `<summary style="${BTN};display:inline-flex;align-items:center;cursor:pointer;list-style:none">Menu ▾</summary><div style="margin-top:6px;${BOX};padding:6px;max-width:200px"><div style="padding:8px 10px">Item one</div><div style="padding:8px 10px">Item two</div><div style="padding:8px 10px">Item three</div></div>`,
            'details',
          ),
        };
      case 'popup':
        return {
          editable: false,
          html: k(
            `<h3 style="margin:0 0 6px;font-size:16px">Popup title</h3><p style="margin:0 0 16px;opacity:.7">What the person sees when this opens.</p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" style="${BTN}">Cancel</button><button type="button" style="${BTN_PRIMARY}">Confirm</button></div>`,
            'div',
            `${BOX};box-shadow:0 12px 40px rgba(0,0,0,.18);max-width:380px`,
          ),
        };
      case 'input':
        return { editable: false, html: k(`<span style="font-size:13px;opacity:.7">Label</span><input style="${FIELD}" placeholder="Type here" />`, 'label', 'display:grid;gap:6px;max-width:320px') };
      case 'toggle':
        return { editable: false, html: k('<input type="checkbox" role="switch" style="width:36px;height:20px" /> Toggle label', 'label', 'display:inline-flex;align-items:center;gap:8px') };
      case 'tabs':
        return {
          editable: false,
          html: k(
            ['Overview', 'Details', 'Activity'].map((t, i) => `<button type="button" style="${i === 0 ? BTN_PRIMARY : BTN};border-radius:8px">${t}</button>`).join(''),
            'div',
            'display:flex;gap:6px',
          ),
        };
      case 'alert':
        return { editable: true, html: k('Heads up: something worth noticing.', 'div', `padding:12px 16px;border-left:4px solid #0d99ff;border-radius:6px;background:#eef7ff;color:#12324d`) };
      case 'badge':
        return { editable: true, html: k('Badge', 'span', 'display:inline-block;padding:2px 10px;border-radius:999px;background:#e7e7e7;color:#1d1d1d;font-size:12px;font-weight:600') };
      case 'heading':
        return { editable: true, html: k('New heading', 'h2', 'margin:0') };
      case 'text':
        return { editable: true, html: k('New paragraph. Click and type to change it.', 'p', 'margin:0;max-width:60ch') };
      case 'list':
        return { editable: false, html: k('<li>First item</li><li>Second item</li><li>Third item</li>', 'ul', 'margin:0;padding-left:20px') };
      case 'image':
        return { editable: false, html: k('', 'div', 'width:240px;height:160px;border-radius:12px;background:linear-gradient(135deg,#d9dde3,#aeb6c2)') };
      case 'button':
      default: {
        const template =
          scope.querySelector('button, [role=button], a.btn, a.button, .btn') ??
          scope.closest('section, form, main, body')?.querySelector('button, [role=button], .btn') ??
          document.querySelector('button');
        const isLink = template?.tagName === 'A';
        const el = document.createElement(isLink ? 'a' : 'button');
        if (template) el.className = template.className;
        else el.setAttribute('style', BTN);
        if (isLink) el.setAttribute('href', '#');
        else el.setAttribute('type', 'button');
        el.textContent = 'New button';
        el.setAttribute('data-pg-id', id);
        el.setAttribute('data-pg-kind', 'button');
        return { editable: true, html: el.outerHTML };
      }
    }
  }

  function addComponent(target: Element, kind: ComponentKind) {
    const container = /^(div|section|form|nav|header|footer|main|aside|li|td|article|fieldset|ul|ol|details)$/i;
    const inline = target.matches(INTERACTIVE) || !container.test(target.tagName);
    const ref = target === document.body || target === document.documentElement ? document.body : target;
    const position: 'after' | 'append' = inline && ref !== document.body ? 'after' : 'append';
    const scope = (inline ? target.parentElement : target) ?? document.body;
    const id = newId('o');
    const { html, editable } = buildComponent(kind, id, scope);
    const t = document.createElement('template');
    t.innerHTML = html;
    const el = t.content.firstElementChild!;
    if (position === 'append') ref.appendChild(el);
    else ref.after(el);
    const name = componentLabel(kind);
    emit({
      id,
      kind: 'insert',
      selector: `[data-pg-id="${id}"]`,
      element: describe(el),
      label: `Added a ${name} ${position === 'append' ? 'inside' : 'after'} ${describe(ref)}`,
      insert: { kind: name, html, ref: selectorOf(ref), position },
      neighbours: neighboursOf(el),
    });
    select(el);
    if (editable) startTextEdit(el);
    else post({ type: 'added', kind: name });
  }

  function duplicate(el: Element) {
    const id = newId('o');
    const clone = el.cloneNode(true) as Element;
    clone.removeAttribute('id');
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone.setAttribute('data-pg-id', id);
    const html = clone.outerHTML;
    el.after(clone);
    emit({
      id,
      kind: 'duplicate',
      selector: `[data-pg-id="${id}"]`,
      element: describe(el),
      label: `Duplicated ${describe(el)}`,
      insert: { html, ref: selectorOf(el), position: 'after' },
      neighbours: neighboursOf(clone),
    });
    select(clone);
  }

  function remove(el: Element) {
    const before = getComputedStyle(el).display;
    const beforeInline = inlineOf(el, 'display');
    (el as HTMLElement).style.setProperty('display', 'none', 'important');
    emit({
      id: newId('o'),
      kind: 'delete',
      selector: selectorOf(el),
      element: describe(el),
      label: `Deleted ${describe(el)}`,
      prop: 'display',
      before,
      after: 'none',
      beforeInline,
    });
    select(null);
  }

  function startTextEdit(el: Element) {
    const before = getText(el);
    if (before === null) return;
    const h = el as HTMLElement;
    const target = el.children.length === 0 ? h : (textNodeOf(el)?.parentElement ?? h);
    editing = target;
    target.setAttribute('contenteditable', 'plaintext-only');
    target.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    let cancelled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        target.blur();
      } else if (e.key === 'Escape') {
        cancelled = true;
        target.blur();
      }
      e.stopPropagation();
    };
    target.addEventListener('keydown', onKey, true);
    target.addEventListener(
      'blur',
      () => {
        target.removeEventListener('keydown', onKey, true);
        target.removeAttribute('contenteditable');
        editing = null;
        const after = (getText(el) ?? '').trim();
        if (cancelled) setText(el, before);
        else if (after !== before.trim()) {
          setText(el, after);
          emit({
            id: newId('o'),
            kind: 'text',
            selector: selectorOf(el),
            element: describe(el),
            label: `Changed text of ${describe(el).split(' "')[0]} from "${before.trim()}" to "${after}"`,
            before: before.trim(),
            after,
          });
        }
      },
      { once: true },
    );
  }

  function styleEdit(selector: string, prop: string, value: string, commit: boolean) {
    const el = q(selector);
    if (!el) return;
    const key = selector + '|' + prop;
    if (!previews.has(key)) previews.set(key, { inline: inlineOf(el, prop), computed: getComputedStyle(el).getPropertyValue(prop) });
    (el as HTMLElement).style.setProperty(prop, value, 'important');
    if (!commit) return;
    const orig = previews.get(key)!;
    previews.delete(key);
    const merged = mergeBase(selector, 'style', prop);
    emit({
      id: merged?.id ?? newId('o'),
      kind: 'style',
      selector,
      element: describe(el),
      label: `Changed ${prop} of ${describe(el)} to ${value}`,
      prop,
      before: merged ? merged.before : orig.computed,
      after: value,
      beforeInline: merged ? merged.beforeInline : orig.inline,
      coalesce: true,
    });
  }

  // ---------- click-through ----------
  function clickThrough(el: Element) {
    hideMenu();
    post({ type: 'clicked', step: { selector: selectorOf(el), text: describe(el) } });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 };
    passthrough = true;
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      (el as HTMLElement).focus?.();
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      (el as HTMLElement).click();
    } finally {
      passthrough = false;
    }
    if (el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]')) {
      setMode('interact');
    }
    scheduleThumb();
  }

  // ---------- context menu (drawn by the editor, so it stays full size at any zoom) ----------
  let menuShown = false;
  function showMenu(x: number, y: number, el: Element) {
    menuShown = true;
    post({
      type: 'menu',
      x,
      y,
      selector: selectorOf(el),
      element: describe(el),
      rect: rectOf(el),
      clickable: el.matches(INTERACTIVE),
      hasText: getText(el) !== null,
      hasParent: !!el.parentElement && el.parentElement !== document.documentElement,
    });
  }
  function hideMenu() {
    if (menuShown) post({ type: 'dismiss' });
    menuShown = false;
  }
  const menuOpen = () => menuShown;

  function compose(kind: CommentType, el: Element) {
    select(el);
    post({ type: 'compose', kind, selector: selectorOf(el), element: describe(el), rect: rectOf(el) });
  }

  // ---------- dragging with snapping ----------
  type Drag = {
    el: Element;
    sx: number;
    sy: number;
    base: { x: number; y: number };
    baseRaw: string;
    r0: DOMRect;
    xs: number[];
    ys: number[];
    moved: boolean;
  };
  let drag: Drag | null = null;
  const SNAP = 6;

  const visible = (e: Element) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };

  function snapLines(el: Element) {
    const cands = new Set<Element>();
    const p = el.parentElement;
    if (p) {
      [...p.children].forEach((c) => cands.add(c));
      if (p !== document.body) cands.add(p);
      if (p.parentElement) [...p.parentElement.children].forEach((c) => cands.add(c));
    }
    const xs: number[] = [];
    const ys: number[] = [];
    let n = 0;
    for (const c of cands) {
      if (c === el || c.contains(el) && c !== p || el.contains(c) || !visible(c) || n++ > 80) continue;
      const r = c.getBoundingClientRect();
      xs.push(r.left, r.left + r.width / 2, r.right);
      ys.push(r.top, r.top + r.height / 2, r.bottom);
    }
    return { xs, ys };
  }

  function snapAxis(start: number, size: number, d: number, lines: number[], scroll: number) {
    const own = [start + d, start + d + size / 2, start + d + size];
    let best: { adj: number; line: number } | null = null;
    for (const o of own)
      for (const l of lines) {
        const adj = l - o;
        if (Math.abs(adj) <= SNAP && (!best || Math.abs(adj) < Math.abs(best.adj))) best = { adj, line: l };
      }
    if (best) return { d: d + best.adj, guide: best.line };
    const doc = start + d + scroll;
    return { d: d + (Math.round(doc / gridSize) * gridSize - doc), guide: null as number | null };
  }

  function drawGuides(gx: number | null, gy: number | null) {
    guides.innerHTML =
      (gx === null ? '' : `<div class="gx" style="transform:translateX(${gx}px)"></div>`) +
      (gy === null ? '' : `<div class="gy" style="transform:translateY(${gy}px)"></div>`);
  }

  function onPointerMove(e: PointerEvent) {
    if (mode !== 'interact' && !drag && !isOurs(e)) {
      const t = pick(e.target);
      if (t !== hovered) hovered = t;
    }
    if (!drag) return;
    const dx0 = e.clientX - drag.sx;
    const dy0 = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx0, dy0) < 3) return;
    drag.moved = true;
    let dx = dx0;
    let dy = dy0;
    let gx: number | null = null;
    let gy: number | null = null;
    if (!e.altKey) {
      const sx = snapAxis(drag.r0.left, drag.r0.width, dx0, drag.xs, scrollX);
      const sy = snapAxis(drag.r0.top, drag.r0.height, dy0, drag.ys, scrollY);
      dx = sx.d;
      dy = sy.d;
      gx = sx.guide;
      gy = sy.guide;
    }
    (drag.el as HTMLElement).style.setProperty('translate', `${Math.round(drag.base.x + dx)}px ${Math.round(drag.base.y + dy)}px`);
    drawGuides(gx, gy);
  }

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    drawGuides(null, null);
    if (!d.moved) return;
    const after = (d.el as HTMLElement).style.translate;
    moveOp(d.el, `${d.base.x}px ${d.base.y}px`, after, d.baseRaw, false);
  }

  /** Move `el` to an absolute translate and record it (merged with an immediately preceding nudge). */
  function nudgeTo(el: Element, x: number, y: number) {
    const beforeInline = inlineOf(el, 'translate');
    const t = parseTranslate((el as HTMLElement).style.translate || '');
    const after = `${Math.round(x)}px ${Math.round(y)}px`;
    (el as HTMLElement).style.setProperty('translate', after);
    moveOp(el, `${t.x}px ${t.y}px`, after, beforeInline, true);
  }

  // ---------- event interception ----------
  // Drag listeners go first: the blockers below stop propagation to later listeners.
  addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  addEventListener('pointerup', endDrag, { capture: true });
  addEventListener('pointercancel', endDrag, { capture: true });
  const BLOCK = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'touchstart', 'touchend', 'submit', 'dragstart', 'input', 'change'];
  for (const type of BLOCK) {
    addEventListener(
      type,
      (e) => {
        if (passthrough || isOurs(e)) return;
        if (editing && e.target instanceof Node && editing.contains(e.target)) return;
        if (mode === 'interact') {
          if (type === 'click') {
            const t = pick(e.target);
            if (t) post({ type: 'clicked', step: { selector: selectorOf(t), text: describe(t) } });
            scheduleThumb();
          }
          return;
        }
        if (type === 'input' || type === 'change') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (menuOpen() && type === 'pointerdown') {
          hideMenu();
          return;
        }
        const pe = e as PointerEvent;
        if (type === 'pointerdown' && pe.button === 0) {
          const t = pick(e.target);
          if (!t) return;
          if (mode === 'select') {
            if (t !== selected) select(t);
            if (t === document.body || t === document.documentElement) return;
            const { xs, ys } = snapLines(t);
            const baseRaw = inlineOf(t, 'translate');
            drag = {
              el: t,
              sx: pe.clientX,
              sy: pe.clientY,
              base: parseTranslate((t as HTMLElement).style.translate || ''),
              baseRaw,
              r0: t.getBoundingClientRect(),
              xs,
              ys,
              moved: false,
            };
          } else if (mode === 'add') {
            addComponent(t, addKind);
            setMode('select');
          } else if (mode === 'comment') {
            compose('comment', t);
            setMode('select');
          }
        }
        if (type === 'dblclick' && mode === 'select') {
          const t = pick(e.target);
          if (t) startTextEdit(t);
        }
      },
      { capture: true },
    );
  }
  document.addEventListener('pointerleave', () => (hovered = null));

  addEventListener(
    'contextmenu',
    (e) => {
      if (isOurs(e)) return e.preventDefault();
      e.preventDefault();
      e.stopImmediatePropagation();
      const t = pick(e.target);
      if (!t) return;
      select(t);
      showMenu(e.clientX, e.clientY, t);
    },
    { capture: true },
  );

  addEventListener('scroll', () => hideMenu(), { capture: true, passive: true });

  // Keys: element shortcuts are handled here; everything else goes to the editor.
  const typing = (t: EventTarget | null) =>
    t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  for (const type of ['keydown', 'keyup', 'keypress']) {
    addEventListener(
      type,
      (e) => {
        const k = e as KeyboardEvent;
        if (isOurs(e)) {
          if (type === 'keydown' && k.key === 'Escape') hideMenu();
          return;
        }
        if (editing) return;
        const ctrl = k.ctrlKey || k.metaKey;
        if (mode === 'interact') {
          const forward = k.key === 'Escape' || (ctrl && /^[zy]$/i.test(k.key));
          if (!forward || typing(e.target) && k.key !== 'Escape') return;
          if (type === 'keydown') post({ type: 'key', key: k.key, ctrl, shift: k.shiftKey, alt: k.altKey });
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (type !== 'keydown') return;
        if (menuOpen()) {
          if (k.key === 'Escape') hideMenu();
          return;
        }
        if (selected && handleElementKey(k, selected)) return;
        post({ type: 'key', key: k.key, ctrl, shift: k.shiftKey, alt: k.altKey });
      },
      { capture: true },
    );
  }

  function handleElementKey(k: KeyboardEvent, el: Element): boolean {
    const ctrl = k.ctrlKey || k.metaKey;
    if (k.key === 'Delete' || k.key === 'Backspace') return remove(el), true;
    if (ctrl && k.key.toLowerCase() === 'd') return duplicate(el), true;
    if (k.key === 'Enter' && k.shiftKey) return el.parentElement && select(el.parentElement), true;
    if (k.key === 'Enter') return startTextEdit(el), true;
    if (k.key === 'Escape') return select(null), true;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[k.key];
    if (!a) return false;
    const step = k.shiftKey ? 1 : gridSize;
    const t = parseTranslate((el as HTMLElement).style.translate || '');
    nudgeTo(el, t.x + a[0] * step, t.y + a[1] * step);
    return true;
  }

  // ---------- thumbnails ----------
  let thumbTimer = 0;
  function scheduleThumb(delay = 1200) {
    clearTimeout(thumbTimer);
    thumbTimer = window.setTimeout(capture, delay);
  }
  async function capture() {
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const dataUrl = await domToJpeg(document.documentElement, {
        width: innerWidth,
        height: innerHeight,
        scale: 0.6,
        quality: 0.75,
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff',
        filter: (n) => n !== host && !(n instanceof Element && n.id === 'pg-cursor'),
      });
      post({ type: 'thumb', dataUrl });
    } catch {
      /* best effort */
    }
  }
  addEventListener('load', () => scheduleThumb(700));

  // ---------- pins ----------
  function sendRects(force = false) {
    if (!pins.length) return;
    const rects: Record<string, Rect | null> = {};
    for (const s of pins) {
      const el = q(s);
      rects[s] = el && visible(el) ? rectOf(el) : null;
    }
    const str = JSON.stringify(rects);
    if (!force && str === lastRects) return;
    lastRects = str;
    post({ type: 'rects', rects });
  }
  addEventListener('scroll', () => requestAnimationFrame(() => sendRects()), { capture: true, passive: true });
  addEventListener('resize', () => sendRects());
  setInterval(() => sendRects(), 500);

  // ---------- messages from the editor ----------
  function setMode(m: Mode) {
    mode = m;
    hideMenu();
    applyMode();
    post({ type: 'mode', mode: m });
  }

  const whenReady = (fn: () => void) =>
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn();

  addEventListener('message', (e: MessageEvent) => {
    if (e.origin !== EDITOR || !e.data?.[PG]) return;
    const m = e.data as ToAgent;
    switch (m.type) {
      case 'init':
        mode = m.mode;
        addKind = m.addKind;
        gridOn = m.grid;
        gridSize = m.gridSize;
        pins = m.pins;
        whenReady(() => {
          const want = new Set(m.ops.map((o) => o.id));
          for (const op of [...applied.values()].reverse()) if (!want.has(op.id)) revertOp(op);
          for (const op of m.ops) applyOp(op, true);
          applyMode();
          sendRects(true);
          scheduleThumb(700);
        });
        break;
      case 'mode':
        mode = m.mode;
        if (m.addKind) addKind = m.addKind;
        hideMenu();
        applyMode();
        break;
      case 'grid':
        gridOn = m.show;
        gridSize = m.size;
        applyMode();
        break;
      case 'apply':
        applyOp(m.op);
        refreshSelected();
        scheduleThumb();
        break;
      case 'revert':
        revertOp(m.op);
        refreshSelected();
        scheduleThumb();
        break;
      case 'style':
        styleEdit(m.selector, m.prop, m.value, m.commit);
        break;
      case 'text': {
        const el = q(m.selector);
        const before = el && getText(el);
        if (el && before !== null && before !== m.value) {
          setText(el, m.value);
          emit({
            id: newId('o'),
            kind: 'text',
            selector: m.selector,
            element: describe(el),
            label: `Changed text of ${describe(el).split(' "')[0]} from "${before}" to "${m.value}"`,
            before: before ?? '',
            after: m.value,
          });
        }
        break;
      }
      case 'nudge': {
        const el = q(m.selector);
        if (el) nudgeTo(el, m.x, m.y);
        break;
      }
      case 'duplicate':
      case 'delete':
      case 'selectParent':
      case 'editText':
      case 'click': {
        const el = q(m.selector);
        if (!el) break;
        if (m.type === 'click') clickThrough(el);
        else if (m.type === 'duplicate') duplicate(el);
        else if (m.type === 'delete') remove(el);
        else if (m.type === 'editText') startTextEdit(el);
        else if (el.parentElement) select(el.parentElement);
        break;
      }
      case 'select':
        whenReady(() => select(m.selector ? q(m.selector) : null, m.scroll));
        break;
      case 'pins':
        pins = m.selectors;
        sendRects(true);
        break;
      case 'replay':
        whenReady(() => replay(m.path));
        break;
      case 'capture':
        capture();
        break;
      case 'menuClosed':
        menuShown = false;
        break;
      case 'place': {
        // The editor catches placement clicks itself, so a busy page can't mis-order them.
        const t = pick(document.elementFromPoint(m.x, m.y)) ?? document.body;
        if (m.what === 'add') addComponent(t, m.kind);
        else compose('comment', t);
        break;
      }
      case 'compose': {
        const el = q(m.selector);
        if (el) compose(m.kind, el);
        break;
      }
    }
  });

  async function replay(path: Step[]) {
    for (const step of path) {
      let el: Element | null = null;
      for (let i = 0; i < 30 && !el; i++) {
        el = q(step.selector);
        if (!el) await new Promise((r) => setTimeout(r, 100));
      }
      if (!el) return;
      clickThrough(el);
      await new Promise((r) => setTimeout(r, 400));
    }
  }
}
