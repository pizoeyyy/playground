import { useEffect, useRef } from 'react';
import { COMPONENTS, componentLabel } from '../shared/components.ts';
import { canUndo, openRound, pendingCount } from '../shared/session.ts';
import type { Mode } from '../shared/protocol.ts';
import { IconAdd, IconComment, IconGrid, IconInteract, IconRedo, IconSelect, IconSend, IconUndo } from './icons.tsx';
import { type Device, redo, saveAndSend, setMode, setState, startAdd, toggleGrid, undo, useStore } from './store.ts';

const TOOLS: { mode: Mode; label: string; shortcut: string; Icon: () => React.JSX.Element }[] = [
  { mode: 'select', label: 'Select and move', shortcut: 'V', Icon: IconSelect },
  { mode: 'interact', label: 'Interact (use the page normally)', shortcut: 'I', Icon: IconInteract },
  { mode: 'comment', label: 'Comment', shortcut: 'C', Icon: IconComment },
];

function ToolButton({ mode, label, shortcut, Icon, active }: (typeof TOOLS)[number] & { active: boolean }) {
  return (
    <button className="tool" data-active={active || undefined} aria-pressed={active} title={`${label} (${shortcut})`} onClick={() => setMode(mode)}>
      <Icon />
    </button>
  );
}

function AddTool() {
  const mode = useStore((s) => s.mode);
  const open = useStore((s) => s.palette);
  const addKind = useStore((s) => s.addKind);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setState({ palette: false });
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);

  const adding = mode === 'add';
  return (
    <div className="add-wrap" ref={ref}>
      <button
        className="tool"
        data-active={adding || open || undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add something to the page (A)"
        onClick={() => setState({ palette: !open })}
      >
        <IconAdd />
      </button>
      {adding && !open && <span className="adding">Click the page to place a {componentLabel(addKind)}</span>}
      {open && (
        <div className="palette" role="menu" aria-label="Add to page">
          {COMPONENTS.map((c) => (
            <button key={c.kind} role="menuitem" className="palette-item" onClick={() => startAdd(c.kind)}>
              <span className="pi-name">{c.label}</span>
              <span className="pi-hint">{c.key ?? c.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const session = useStore((s) => s.session);
  const mode = useStore((s) => s.mode);
  const grid = useStore((s) => s.grid);
  const device = useStore((s) => s.device);
  const sending = useStore((s) => s.sending);
  if (!session) return <header className="topbar" />;
  const pending = pendingCount(session);
  const inFlight = openRound(session);
  const name = session.target.split(/[\\/]/).pop() || session.target;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden />
        <span className="title">playground</span>
        <span className="target" title={session.target}>{name}</span>
      </div>

      <div className="tools" role="toolbar" aria-label="Tools">
        {TOOLS.slice(0, 2).map((t) => (
          <ToolButton key={t.mode} {...t} active={mode === t.mode} />
        ))}
        <AddTool />
        {TOOLS.slice(2).map((t) => (
          <ToolButton key={t.mode} {...t} active={mode === t.mode} />
        ))}
        <span className="divider" />
        <button className="tool" title="Undo (Ctrl+Z)" disabled={!canUndo(session)} onClick={undo}>
          <IconUndo />
        </button>
        <button className="tool" title="Redo (Ctrl+Shift+Z)" disabled={session.undoPointer >= session.ops.length} onClick={redo}>
          <IconRedo />
        </button>
        <span className="divider" />
        <button className="tool" data-active={grid || undefined} aria-pressed={grid} title="Grid and snapping guides (')" onClick={toggleGrid}>
          <IconGrid />
        </button>
      </div>

      <div className="right">
        <select className="device" value={device} aria-label="Device size" onChange={(e) => setState({ device: e.target.value as Device })}>
          <option value="desktop">Desktop · 1280</option>
          <option value="tablet">Tablet · 768</option>
          <option value="mobile">Mobile · 390</option>
        </select>
        <button
          className="send"
          disabled={!!inFlight || sending || pending === 0}
          onClick={saveAndSend}
          title={inFlight ? 'Claude is working on the last round' : 'Save and send to Claude (Ctrl+Enter)'}
        >
          <IconSend />
          {inFlight ? 'Claude is working…' : 'Save and send'}
          {!inFlight && pending > 0 && <span className="count">{pending}</span>}
        </button>
      </div>
    </header>
  );
}
