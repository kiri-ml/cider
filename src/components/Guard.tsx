import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import type { PropsWithChildren } from "react";
import type { StageId } from "../types";
import { canOpenStage } from "../session/session";
import { useSession } from "../session/useSession";

export function Guard({ stage, children }: PropsWithChildren<{ stage: StageId }>) {
  const { session, loading, prepareStage } = useSession();
  const preparedStageRef = useRef<StageId | null>(null);

  useEffect(() => {
    if (loading || !session || stage === "import" || preparedStageRef.current === stage) return;
    preparedStageRef.current = stage;
    void prepareStage(stage);
  }, [loading, prepareStage, session, stage]);

  if (loading) return <main className="shell"><div className="panel">Loading session...</div></main>;
  if (!session) return <Navigate to="/" replace />;
  if (!canOpenStage(session, stage)) return <Navigate to="/import" replace />;
  return <>{children}</>;
}
