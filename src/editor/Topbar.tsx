import { canUndo, openRound, pendingCount } from '../shared/session.ts';
import type { Mode } from '../shared/protocol.ts';
import { IconButton, IconComment, IconGrid, IconInteract, IconRedo, IconSelect, IconSend, IconUndo } from './icons.tsx';
import { type Device, redo, saveAndSend, setMode, setState, toggleGrid, undo, useStore } from './store.ts';

const TOOLS: { mode: Mode; label: string; key: string; Icon: () => React.JSX.Element }[] = [
  { mode: 'select', label: 'Select and move', key: 'V', Icon: IconSelect },
  { mode: 'interact', label: 'Interact (use the page normally)', key: 'I', Icon: IconInteract },
  { mode: 'button', label: 'Add a button', key: 'B', Icon: IconButton },
  { mode: 'comment', label: 'Comment', key: 'C', Icon: IconComment },
];

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
        {TOOLS.map(({ mode: m, label, key, Icon }) => (
          <button
            key={m}
            className="tool"
            data-active={mode === m || undefined}
            aria-pressed={mode === m}
            title={`${label} (${key})`}
            onClick={() => setMode(m)}
          >
            <Icon />
          </button>
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
