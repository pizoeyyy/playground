import { useState } from 'react';
import { IconClose, IconReplay } from './icons.tsx';
import { act, loadSlide, replaySlide, useStore } from './store.ts';

export function SlidesRail() {
  const session = useStore((s) => s.session);
  const current = useStore((s) => s.current);
  const [renaming, setRenaming] = useState<string | null>(null);
  if (!session) return <aside className="rail" />;

  return (
    <aside className="rail" aria-label="Slides">
      <div className="rail-head">Slides</div>
      <ol className="slides">
        {session.slides.map((sl, i) => {
          const open = session.comments.filter((c) => c.slide === sl.id && c.status === 'open').length;
          const parentIndex = session.slides.findIndex((x) => x.id === sl.parent);
          return (
            <li key={sl.id} className="slide" data-active={sl.id === current || undefined} data-frozen={sl.frozen ? '' : undefined}>
              <button className="thumb" onClick={() => loadSlide(sl.id)} aria-label={`Open slide ${i + 1}, ${sl.label}`}>
                <span className="num">{i + 1}</span>
                {sl.thumb ? <img src={sl.thumb} alt="" /> : <span className="blank" />}
                {open > 0 && <span className="badge" title={`${open} open comment(s)`}>{open}</span>}
              </button>
              <div className="meta">
                {renaming === sl.id ? (
                  <input
                    className="rename"
                    autoFocus
                    defaultValue={sl.label}
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label) act({ type: 'updateSlide', id: sl.id, patch: { label } });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="label" onDoubleClick={() => setRenaming(sl.id)} title="Double-click to rename">
                    {sl.label}
                  </span>
                )}
                <span className="sub" title={sl.frozen ? sl.frozen.url : sl.url}>
                  {sl.frozen
                    ? `❄ frozen from ${parentIndex + 1} · ${new Date(sl.frozen.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                    : sl.path.length
                      ? `from ${parentIndex + 1} · ${sl.path.map((p) => p.text).join(' › ')}`
                      : sl.url}
                </span>
              </div>
              <div className="slide-actions">
                {sl.path.length > 0 && (
                  <button className="mini" title="Replay the clicks that lead here" onClick={() => replaySlide(sl.id)}>
                    <IconReplay />
                  </button>
                )}
                {i > 0 && (
                  <button
                    className="mini"
                    title="Delete slide"
                    onClick={() => {
                      if (confirm(`Delete slide ${i + 1} and its comments and edits?`)) act({ type: 'deleteSlide', id: sl.id });
                    }}
                  >
                    <IconClose />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="rail-hint">Right-click a button → <b>Click this button</b>. If it opens another page, that page becomes the next slide.</p>
    </aside>
  );
}
