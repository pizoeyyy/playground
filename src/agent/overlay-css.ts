// Styles for the in-page overlay. Lives in a shadow root, so it never leaks into the page.
export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.box { position: fixed; left: 0; top: 0; display: none; pointer-events: none; }
.hover { outline: 1px solid #0d99ff; }
.sel { outline: 2px solid #0d99ff; }
.tag {
  position: absolute; left: -2px; top: -22px; max-width: 280px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; padding: 3px 6px; border-radius: 4px 4px 4px 0; background: #0d99ff; color: #fff;
  font: 500 11px/14px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif;
}
.grid {
  position: fixed; inset: 0; display: none; pointer-events: none;
  background-image:
    linear-gradient(to right, rgba(242, 72, 34, 0.10) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(242, 72, 34, 0.10) 1px, transparent 1px);
}
.guides .gx, .guides .gy { position: fixed; left: 0; top: 0; background: #f24822; pointer-events: none; }
.guides .gx { width: 1px; height: 100vh; }
.guides .gy { height: 1px; width: 100vw; }
`;
