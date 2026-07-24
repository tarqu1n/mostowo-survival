# Extensibility Lens — extension seams to add

Spots that resist "edit data, not code", biased to the three chosen goals: **adding content ·
editor tooling · testability**. Reference pattern for every proposal below is `StructureManager`
(`src/scenes/world/StructureManager.ts:69-160`): a `register(key, module)` + `behavior<M>(key)`
registry where each buildable is one `StructureBehavior` module + one `register` call + one
`BUILDABLES` data entry — a new buildable is one registration, not edits in N places.

See also [testability-targets.md](testability-targets.md) — the pure modules these seams create and the unit tests they warrant.

## a. Extension seams to add

### Seam 1 — Action-kind registry (adding content; the seeded finding)

Adding one worker order kind (the `repair` companion order and every future NPC/creature order)
today requires coordinated edits across **8-9 distinct sites in 4 files** — not the seed's "3+".
Confirmed current locations:

|#|Site|Location|What must be added|
|-|-|-|-|
|1|`Action` union|systems/tasks.ts:7-14|new `{kind;…}` variant|
|2|update() dispatch|GameScene.ts:1045 `switch(action.kind)`|new `case` → `runX`|
|3|run handler|GameScene.ts:1347+ (`runHarvest`…`runRearm`)|new `runX` method|
|4|begin/stand-tile|GameScene.ts:1134-1224 (`if (a.kind===…)` chain in `beginCurrent`)|new target/stand-tile block|
|5|enqueue de-dupe|GameScene.ts:1245-1259|new `if (a.kind===… && isXQueued) toggleX` branch|
|6|queued predicate|GameScene.ts:1268-1316 (`isHarvest/Refuel/Deconstruct/RearmQueued`)|new `isXQueued`|
|7|toggle|GameScene.ts:1275-1326 (`toggleHarvest/Refuel/Deconstruct/Rearm`)|new `toggleX`|
|8|crash-report target|GameScene.ts:307-315 `describeActionTarget`|new `if (a.kind===…)`|
|9|queue highlight|fx/TaskGlowRenderer.ts:71-102|new `else if (a.kind===…)` outline branch|
|(+)|pick→order|input/ScenePicker.ts:76-93 `actionAt`|only if the order is tap-driven|

Sites 5/6/7 are the "toggle/queue quartet" — four near-identical predicate+toggle pairs that differ
only in the kind string and the target-id field (`treeId`/`campfireId`/`wallId`/`trapId`). They are
pure `queue.all()`/`queue.removeWhere` logic with no per-kind behavior beyond "which field is the
target id".

**Proposed registry (mirrors `StructureManager`).** One `OrderBehavior<A>` module per kind +
one `register(kind, behavior)` call + the existing `Action` data variant:

```
interface OrderBehavior<A extends Action> {
  targetId(a: A): string | null;      // the de-dupe key (null for move); collapses the quartet
  begin(a: A): Cell | null;           // resolve stand tile / abort — replaces the beginCurrent block
  run(a: A, delta: number): void;     // per-frame work — replaces the switch case + runX
  describe(a: A): string;             // crash-report target — replaces describeActionTarget branch
  highlight(a: A): void;              // queue glow — replaces the TaskGlowRenderer branch
  pickPriority?: number;              // optional: participate in ScenePicker.actionAt
}
class OrderRegistry {
  register(kind: string, b: OrderBehavior<Action>): void;
  behavior<M extends OrderBehavior<Action>>(kind: string): M;   // mirrors StructureManager.behavior<M>
  isQueued(q: TaskQueue, a: Action): boolean;  // generic: q.all().some(x => sameKind && sameTargetId)
  toggle(q: TaskQueue, a: Action): boolean;    // generic: q.removeWhere(sameKind && sameTargetId)
}
```

Effect: sites 2,3,4,5,6,7,8,9 collapse to **one `register(kind, module)` call**. `isQueued`/`toggle`
become one generic implementation each (over `targetId`), deleting the four-way quartet. The
`Action` union (site 1) stays as the data shape — same split as `StructureBehavior` (behavior
module) vs `BUILDABLES` (data entry). Registration lives in `buildWorld()` beside the
`StructureManager` registrations. This is Phase-4 Step 14.

### Seam 2 — Editor tool registry (editor tooling)

Adding one `EditorTool` is a multi-site edit, not a data entry. The seeded `TOOL_LIBRARY_FILTER`
static record (editorStore.ts:160-167) is the smallest case — a new painting tool needs both the
`EditorTool` union (editorStore.ts:129-145) **and** a `TOOL_LIBRARY_FILTER` map entry to auto-sync
the Library role filter (edit-in-two-places). But a full new tool also touches its Toolbar button
(`Toolbar.tsx`), on-canvas dispatch/cursor (`EditorScene.ts`), and touch-parity `ContextBar.tsx` —
so the union is really the hub of a 4-5 site fan-out.

Proposed: a `TOOL_DEFS: Record<EditorTool, ToolDef>` data table (one entry per tool: `roleFilter?`,
`paintTarget?`, `cursor`, `label`, `icon`, `contextBarMode?`) that the filter map, Toolbar, cursor
logic, and ContextBar all read — so a new tool is one `TOOL_DEFS` entry + the union member. Lower
priority than Seam 1 (tools change rarely); log as a follow-up seam, not required this pass. Existing
coverage: `editorStoreLibraryRoleFilter.test.ts` already pins the filter auto-sync — extend it if the
table lands.

### Seam 3 — ScenePicker order mapping (adding content, minor)

`ScenePicker.actionAt` (input/ScenePicker.ts:76-93) hard-codes each pick→order mapping
(`tree→harvest`, `campfire→refuel`, spent-`trap→rearm`, else `move`). A new tap-driven order kind
edits this too. If Seam 1's `OrderBehavior` gains the optional `pickFrom(pick)` / `pickPriority`,
`actionAt` becomes a priority-ordered scan over registered behaviors — folding this into Seam 1
rather than a separate registry.
