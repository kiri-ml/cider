import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PropsWithChildren } from "react";
import type { StageId } from "../types";
import { stageIndex, stages } from "../session/session";
import { useSession } from "../session/useSession";
import { Stepper } from "./Stepper";

type Props = PropsWithChildren<{ title: string; description: string; stage?: StageId; nextLabel?: string; nextDisabled?: boolean; contentClassName?: string; onNext?: () => void | Promise<void> }>;

export function Layout({ title, description, stage, nextLabel = "Next", nextDisabled, contentClassName = "panel", onNext, children }: Props) {
  const navigate = useNavigate();
  const { session, prepareStage, resetSession } = useSession();
  const [navigating, setNavigating] = useState(false);

  const stagePosition = stage ? stageIndex(stage) : -1;
  const previousStage = stagePosition > 0 ? stages[stagePosition - 1] : null;
  const nextStage = stagePosition >= 0 && stagePosition < stages.length - 1 ? stages[stagePosition + 1] : null;

  if (!session) return <main className="shell">{children}</main>;

  async function startOver() {
    if (!window.confirm("Start a new CIDER session and replace the current local session?")) return;
    await resetSession();
    navigate("/import");
  }

  async function goToStage(target: StageId) {
    const destination = stages.find((item) => item.id === target);
    if (!destination || navigating) return;
    setNavigating(true);
    try {
      await prepareStage(target);
      navigate(destination.path);
    } finally {
      setNavigating(false);
    }
  }

  async function goNext(target: StageId) {
    if (onNext) await onNext();
    await goToStage(target);
  }

  return <main className="shell">
    <header className="app-header"><div><p className="eyebrow">Chat Inspection · Detection · Event Review</p><h1>{title}</h1><p className="muted">{description}</p></div><button className="ghost danger" onClick={startOver}>Start over</button></header>
    <Stepper session={session} onSelectStage={goToStage} disabled={navigating} />
    <section className={contentClassName}>{children}</section>
    <footer className="nav-footer">
      {previousStage && <button className="secondary" disabled={navigating} onClick={() => void goToStage(previousStage.id)}>Back</button>}
      <span className="spacer" />
      {nextStage && <button className="primary" disabled={nextDisabled || navigating} onClick={() => void goNext(nextStage.id)}>{navigating ? "Processing..." : nextLabel}</button>}
    </footer>
  </main>;
}
