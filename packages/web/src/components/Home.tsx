import { useState } from 'react';
import { loadName, saveName, saveSession, send } from '../net';

export function Home() {
  const params = new URLSearchParams(location.search);
  const invited = (params.get('room') ?? '').toUpperCase().slice(0, 4);
  const [name, setName] = useState(loadName());
  const [code, setCode] = useState(invited);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async (kind: 'create' | 'join') => {
    setError('');
    const n = name.trim();
    if (!n) return setError('Enter your name first');
    if (kind === 'join' && code.trim().length !== 4) return setError('Room codes are 4 letters');
    setBusy(true);
    saveName(n);
    const r = kind === 'create' ? await send('room:create', { name: n }) : await send('room:join', { code, name: n });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    saveSession(r.session);
    if (invited) history.replaceState(null, '', '/');
  };

  return (
    <main className="home">
      <div className="home-hero">
        <div className="home-cards" aria-hidden="true">
          <div className="hc hc1">
            <span>J</span>
            <i>♣</i>
          </div>
          <div className="hc hc2 red">
            <span>7</span>
            <i>♥</i>
          </div>
          <div className="hc hc3">
            <span>A</span>
            <i>♠</i>
          </div>
        </div>
        <h1 className="wordmark big">CRAZY</h1>
        <p className="tagline">The Ethiopian card game. Play with friends.</p>
      </div>

      <div className="panel">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            maxLength={16}
            autoComplete="nickname"
            placeholder="e.g. Natnael"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {invited ? (
          <>
            <button className="btn gold" disabled={busy} onClick={() => go('join')}>
              Join room {invited}
            </button>
            <button className="btn ghost" disabled={busy} onClick={() => go('create')}>
              Start my own game instead
            </button>
          </>
        ) : (
          <>
            <button className="btn gold" disabled={busy} onClick={() => go('create')}>
              Create a game
            </button>
            <div className="divider">
              <span>or join with a code</span>
            </div>
            <div className="join-row">
              <input
                className="code-input"
                aria-label="Room code"
                value={code}
                maxLength={4}
                placeholder="CODE"
                autoCapitalize="characters"
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && go('join')}
              />
              <button className="btn outline" disabled={busy} onClick={() => go('join')}>
                Join
              </button>
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </main>
  );
}
