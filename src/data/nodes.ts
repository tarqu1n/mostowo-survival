/**
 * Resource node catalogue. Keyed by node id; add new harvestable nodes here. A node is just data —
 * a rock is the same machinery as a tree with a different sprite role, yield, and footprint (see
 * ResourceNodeDef).
 *
 * The defs themselves are now authored in `src/data/maps/nodes.json` (plan 021 step 2) — this file
 * is just a shim: eager-import the JSON and fail-fast validate it through `parseNodeDefs`
 * (`src/systems/nodeDefs.ts`), same eager-import + parse-at-module-load pattern `mapRuntime.ts` uses
 * for `world.json`/`manifest.json`. Adding a species means a new record in `nodes.json`, not new
 * code here or in GameScene.
 */

import nodesJson from './maps/nodes.json';
import { parseNodeDefs } from '../systems/nodeDefs';

export const NODES = parseNodeDefs(nodesJson);
