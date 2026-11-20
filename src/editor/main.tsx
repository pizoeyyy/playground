import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { CompareModal, Panel } from './Panel.tsx';
import { SlidesRail } from './SlidesRail.tsx';
import { Stage } from './Stage.tsx';
import { connect, onAgentMessage, onEditorKey, resumeAfterLoop, useStore } from './store.ts';
import { Topbar } from './Topbar.tsx';

function App() {
  const ready = useStore((s) => !!s.session);
  const toast = useStore((s) => s.toast);
  const reloadLoop = useStore((s) => s.reloadLoop);
  useEffect(() => {
    connect();
    addEventListener('message', onAgentMessage);
    addEventListener('keydown', onEditorKey);
    return () => {
      removeEventListener('message', onAgentMessage);
      removeEventListener('keydown', onEditorKey);
    };
  }, []);
  return (
    <div className="app">
      <Topbar />
      {reloadLoop && (
        <div className="loop-banner" role="alert">
          <b>This page keeps reloading itself.</b> Live reload and thumbnails are paused so they can't feed the loop. The
          usual cause is a dev tool that reloads on file changes (VS Code Live Server, browser-sync) or a redirect loop in
          the page.
          <button className="ghost small" onClick={resumeAfterLoop}>Resume</button>
        </div>
      )}
      <div className="body">
        <SlidesRail />
        {ready ? <Stage /> : <main className="stage" />}
        <Panel />
      </div>
      <CompareModal />
      <div className="toast" role="status" data-show={!!toast || undefined}>{toast}</div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
