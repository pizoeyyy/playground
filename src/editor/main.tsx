import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { CompareModal, Panel } from './Panel.tsx';
import { SlidesRail } from './SlidesRail.tsx';
import { Stage } from './Stage.tsx';
import { connect, onAgentMessage, onEditorKey, useStore } from './store.ts';
import { Topbar } from './Topbar.tsx';

function App() {
  const ready = useStore((s) => !!s.session);
  const toast = useStore((s) => s.toast);
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
