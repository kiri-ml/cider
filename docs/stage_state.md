# Stage State Model

The web app treats the review flow as a lazy pipeline of stages. Each stage has
two durable concepts:

- **initial**: the semantic input derived from earlier stage output.
- **output**: the reviewed result currently owned by that stage.

Stages do not use a separate save or commit layer. User edits update the current
stage output directly. Later stages are not rebuilt immediately when earlier
outputs change; they are checked and refreshed only when the user enters them.

## Pipeline

Data flows forward through reviewed outputs:

1. Import produces OCR results from accepted cropped slices.
2. Issues produces the reviewed base log records.
3. Cleanup produces the final reviewed records.
4. Results produces sorted and deduplicated results records.
5. Export produces export settings and generated export data.

For Import specifically, `initial` is the sorted set of active accepted source
image SHA256 checksums. Accepted slices are deterministic supporting assets
derived from those source images. Import `output` is the current Import
recognition mode plus the OCR result set whose slices belong to active accepted
images, including each result's recognition-mode provenance.

Shared image and slice assets are supporting data for the flow, not independently
editable stage output. Rejected Import images and removed accepted images are
garbage-collected when leaving Import. Removed accepted images may temporarily
keep their slices and OCR results while the user remains on Import so re-adding
the same image can reuse the slot. Rejected images are metadata-only feedback and
do not receive pipeline image ids. Transient UI state, such as focused rows, open
editors, filters, and scroll position, is not part of the pipeline model.

## Lazy Refresh

When a stage is entered, the app derives that stage's current `initial` from the
previous stage output and compares it with the last recorded `initial` for that
stage.

If the derived `initial` is unchanged, the existing stage output is preserved.
This allows a user to move backward and forward without losing edits when the
upstream changes are irrelevant to the stage.

If the derived `initial` changed, the stage output is recreated from that new
input. Downstream stages are then considered stale, but they are still refreshed
only when entered.

## Stepper Reachability

The stepper is state-aware. It tracks whether previously visited stage outputs
still match the outputs that downstream stages were prepared from.

If a user goes back and changes a historical stage output, future stages beyond
the immediate next stage are disabled. This prevents jumping into stale future
state.

If the user changes the stage output back to the same semantic value as before,
the previous reach is restored automatically. Reachability is based on semantic
stage output, not object identity or transient UI state.

## Design Intent

The model keeps navigation simple while preserving reviewed work whenever it is
still valid. Each stage decides what parts of upstream data matter to its
`initial`, and what reviewed data counts as its `output`. This lets stage
internals evolve without changing the overall state-management design.
