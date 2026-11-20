// Styles for the in-page overlay. Lives in a shadow root, so it never leaks into the page.
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; left: 0; top: 0; display: none; pointer-events: none; }
.hover { outline: calc(1px * var(--s, 1)) solid #0d99ff; }
.sel { outline: calc(2px * var(--s, 1)) solid #0d99ff; }
.tag, .dim {
  position: absolute; max-width: calc(280px * var(--s, 1)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: calc(3px * var(--s, 1)) calc(6px * var(--s, 1)); background: #0d99ff; color: #fff; pointer-events: none;
  font: 500 calc(11px * var(--s, 1)) / 1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
}
.tag { left: 0; bottom: 100%; margin-bottom: calc(2px * var(--s, 1)); border-radius: calc(4px * var(--s, 1)) calc(4px * var(--s, 1)) calc(4px * var(--s, 1)) 0; }
.dim { left: 50%; top: 100%; translate: -50% calc(6px * var(--s, 1)); border-radius: calc(4px * var(--s, 1)); }
.h {
  position: absolute; display: none; box-sizing: border-box; pointer-events: auto;
  width: calc(9px * var(--s, 1)); height: calc(9px * var(--s, 1));
  margin: calc(-4.5px * var(--s, 1)) 0 0 calc(-4.5px * var(--s, 1));
  background: #fff; border: calc(1.5px * var(--s, 1)) solid #0d99ff; border-radius: calc(2px * var(--s, 1));
}
.sel[data-handles] .h { display: block; }
.h[data-h="nw"] { left: 0; top: 0; cursor: nwse-resize; }
.h[data-h="n"] { left: 50%; top: 0; cursor: ns-resize; }
.h[data-h="ne"] { left: 100%; top: 0; cursor: nesw-resize; }
.h[data-h="e"] { left: 100%; top: 50%; cursor: ew-resize; }
.h[data-h="se"] { left: 100%; top: 100%; cursor: nwse-resize; }
.h[data-h="s"] { left: 50%; top: 100%; cursor: ns-resize; }
.h[data-h="sw"] { left: 0; top: 100%; cursor: nesw-resize; }
.h[data-h="w"] { left: 0; top: 50%; cursor: ew-resize; }
.grid {
  position: fixed; inset: 0; display: none; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(242, 72, 34, 0.10) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(242, 72, 34, 0.10) 1px, transparent 1px);
}
.guides .gx, .guides .gy { position: fixed; left: 0; top: 0; background: #f24822; pointer-events: none; }
.guides .gx { width: calc(1px * var(--s, 1)); height: 100vh; }
.guides .gy { height: calc(1px * var(--s, 1)); width: 100vw; }
`;
