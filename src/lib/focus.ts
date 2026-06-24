import type { FocusEvent } from "react";

export function focusLeftContainer(event: FocusEvent<HTMLElement>) {
  const nextTarget = event.relatedTarget;
  return !(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget);
}
