import { useNavigate } from "react-router-dom";
import { loadSessionMetadata } from "../session/session";
import { useSession } from "../session/useSession";

export function HomePage() {
  const navigate = useNavigate();
  const { startNewSession, restoreSession, loading } = useSession();
  const hasSession = !!loadSessionMetadata();
  async function restore() { const session = await restoreSession(); if (session) navigate("/import"); }
  async function start() { await startNewSession(); navigate("/import"); }
  return <main className="home-shell"><section className="hero-card"><p className="eyebrow">Chat Inspection · Detection · Event Review</p><div className="home-intro"><div><h1 className="home-title">Cider</h1><p className="large muted">Turn Maple event screenshots into clean buff logs for audits, summaries, and exports.<br />Everything is processed locally on your device.</p></div><img className="home-icon" src="/assets/icons/cider.png" alt="" aria-hidden="true" /></div><div className="home-actions"><button className="secondary large-button" disabled={!hasSession || loading} onClick={restore}>Restore previous session</button><button className="primary large-button" disabled={loading} onClick={start}>Start a new session</button></div><p className="muted small home-note">One resumable session is stored locally. Starting a new session replaces the previous one.</p></section></main>;
}
