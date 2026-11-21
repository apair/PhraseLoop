import { useState } from 'react';
import { Home } from './Home';
import { Review } from './Review';
import { Settings } from './Settings';
import { useOnline, useSync } from './hooks';

type Screen = 'home' | 'review' | 'settings';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const online = useOnline();
  const sync = useSync(online);

  return (
    <div className="app">
      <header className="topbar">
        <h1>PhraseLoop</h1>
        <span className={`pill ${online ? 'pill-ok' : 'pill-warn'}`} role="status">
          {online ? 'Online' : 'Offline - using saved cards'}
        </span>
        {screen === 'home' && (
          <button className="link" onClick={() => setScreen('settings')}>
            Settings
          </button>
        )}
      </header>
      <main>
        {screen === 'home' && <Home sync={sync} online={online} onStart={() => setScreen('review')} />}
        {screen === 'review' && <Review onExit={() => setScreen('home')} />}
        {screen === 'settings' && <Settings sync={sync} online={online} onBack={() => setScreen('home')} />}
      </main>
    </div>
  );
}
