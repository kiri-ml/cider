import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import type { Session, StageId } from "../types";
import { clearSession, createNewSession, hydrateSessionUrls, loadSessionMetadata, revokeSessionUrls, saveSession } from "./session";
import { enterStage } from "./stageManagement";

type SessionContextValue = {
  session: Session | null;
  loading: boolean;
  updateSession: (updater: (session: Session) => Session | Promise<Session>) => Promise<void>;
  prepareStage: (stage: StageId) => Promise<Session | null>;
  startNewSession: () => Promise<Session>;
  restoreSession: () => Promise<Session | null>;
  resetSession: () => Promise<Session>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSessionState] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);

  const restoreSession = useCallback(async () => {
    const meta = loadSessionMetadata();
    if (!meta) {
      setSession(null);
      setLoading(false);
      return null;
    }
    const hydrated = await hydrateSessionUrls(meta);
    revokeSessionUrls(sessionRef.current);
    setSession(hydrated);
    setLoading(false);
    return hydrated;
  }, [setSession]);

  useEffect(() => { void restoreSession(); }, [restoreSession]);
  useEffect(() => () => revokeSessionUrls(sessionRef.current), []);

  const updateSession = useCallback(async (updater: (session: Session) => Session | Promise<Session>) => {
    const current = sessionRef.current;
    if (!current) return;
    const updated = await updater(current);
    setSession(updated);
    saveSession(updated);
    revokeReplacedUrls(current, updated);
  }, [setSession]);

  const prepareStage = useCallback(async (stage: StageId) => {
    const current = sessionRef.current;
    if (!current) return null;
    const updated = await enterStage(current, stage);
    setSession(updated);
    saveSession(updated);
    revokeReplacedUrls(current, updated);
    return updated;
  }, [setSession]);

  const startNewSession = useCallback(async () => {
    await clearSession();
    const created = createNewSession();
    saveSession(created);
    revokeSessionUrls(sessionRef.current);
    setSession(created);
    setLoading(false);
    return created;
  }, [setSession]);

  const resetSession = useCallback(async () => startNewSession(), [startNewSession]);

  const value = useMemo(() => ({ session, loading, updateSession, prepareStage, startNewSession, restoreSession, resetSession }), [session, loading, updateSession, prepareStage, startNewSession, restoreSession, resetSession]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function revokeReplacedUrls(oldSession: Session, newSession: Session): void {
  const newImageUrls = new Set(newSession.images.map((image) => image.url).filter(Boolean));
  const newSliceUrls = new Set(newSession.slices.map((slice) => slice.url).filter(Boolean));
  for (const image of oldSession.images) if (image.url && !newImageUrls.has(image.url)) URL.revokeObjectURL(image.url);
  for (const slice of oldSession.slices) if (slice.url && !newSliceUrls.has(slice.url)) URL.revokeObjectURL(slice.url);
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
