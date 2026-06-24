import { useLocation } from "react-router-dom";
import type { Session, StageId } from "../types";
import { canOpenStage, stageIndex, stages } from "../session/session";
import { reachableStageIndex } from "../session/stageManagement";

export function Stepper({ session, onSelectStage, disabled }: { session: Session; onSelectStage: (stage: StageId) => void | Promise<void>; disabled?: boolean }) {
  const location = useLocation();
  const currentStage = stages.find((stage) => stage.path === location.pathname)?.id ?? session.currentStage;
  const currentIndex = stageIndex(currentStage);
  const reachableIndex = reachableStageIndex(session);
  return <nav className="stepper" aria-label="Wizard progress">
    {stages.map((stage, index) => {
      const current = stage.id === currentStage;
      const done = index < currentIndex;
      const enabled = !disabled && index <= reachableIndex && canOpenStage(session, stage.id);
      const inner = <><span className={`step-dot ${done ? "complete" : ""} ${current ? "current" : ""}`}>{done ? "✓" : index + 1}</span><span>{stage.label}</span></>;
      return enabled ? <button key={stage.id} type="button" className={`step ${current ? "current" : ""}`} onClick={() => void onSelectStage(stage.id)}>{inner}</button> : <span key={stage.id} className="step disabled">{inner}</span>;
    })}
  </nav>;
}
