# Testing decisions

The test harness, isolated deterministic setups, and determinism choices.

Part of the [decision log index](../DECISIONS.md). Newest first.

---

## 2026-07-12 — [DECIDED] Toward isolated test setups, not one live-game end-to-end smoke

The headless smoke drives the whole running game start-to-finish. That's already fragile and won't
scale as content grows — one linear playthrough can't cover every action/animation/interaction. Case
in point: the Punch step relied on a real-time movepad walk landing the player exactly one tile from a
chasing zombie; it flaked ~50% (the player walked *through* the collisionless zombie and co-located,
so Punch's single facing-adjacent tile was empty). Reworked to *aggro-then-settle* (walk only until
the zombie aggros, hold still, let it stop one tile below, then punch) — stable, but still indirect.
Direction: prefer **isolated, deterministic scenarios** — place the player + entities on known tiles,
set facing, trigger the one action under test, assert the result — over navigating there through live
play. The end-to-end smoke stays as a broad boot/core-loop sanity check; specific behaviours get their
own focused setups. **[RESOLVED 2026-07-12 — see the "Three-tier deterministic test harness" entry
below]** harness shape: a debug scenario API on GameScene, chosen over a dedicated test scene or a
query-param loader.

## 2026-07-12 — [DECIDED] Three-tier deterministic test harness (plan 007), retiring the live-game smoke

Resolves the harness-shape **[OPEN]** above. The single ~400-line `scripts/smoke.mjs` drove the
*whole* running game start-to-finish through the real UI and asserted ~35 things along one linear
playthrough — so it broke whenever anything on that path changed (the queue-marker assertion broke
when the outline shader landed; the chop step flaked on wall-clock timing when the glow got heavier),
and one playthrough can't cover every action. Replaced with three tiers:

1. **Unit tests — Vitest, plain Node (`npm test`).** The pure systems (`pathfind`, `tasks`, `combat`,
   `grid`, `stats`, `Inventory`) + data invariants, where most of the previously-smoke-asserted logic
   actually lives. Millisecond-fast, zero timing. Vitest because the project is already Vite (native
   fit, shared resolution/tsconfig). `Inventory` was made Node-testable by importing `eventemitter3`
   directly instead of via the full `phaser` package (behaviour-identical emitter — avoids Phaser's
   canvas feature-detection at import, so no jsdom/canvas-mock).
2. **Scenario tests — Playwright, deterministic (`npm run e2e`).** For the genuine
   integration/render/input surface that needs a browser (zoom/pan/camera, mode toggles, Inspect
   panels, the outline PostFX attach, movepad, scene restart, shader compile). Driven by a **DEV-only
   scenario API** on `GameScene` (`window.game.__test`): `applyScenario(spec)` builds a known world
   from a **declarative spec** (`{player:[3,3], trees:[[5,3]]}`) fed to one `applyScenario` — never
   hand-authored maps — and a **fixed-delta `step(ms)`** seam that stops the RAF loop and drives
   `game.step(t, fixedDelta)` so movement/chop/build/contact-cooldown/regrow resolve with **zero
   wall-clock** (a manual `scene.update()` would NOT advance physics/clock/timers). Named fixture
   builders (`tests/e2e/scenarios.ts`: `justATree`/`oneZombie`/`wallToRouteAround`) for shared shapes;
   one behaviour per spec, entities placed adjacent so there's no multi-second walk to race.
3. **Boot canary (`npm run smoke`).** What's left of the old smoke: boot the production bundle, reach
   `Game`+`UI`, render a few frames (compiling every WebGL shader), assert **zero console errors**,
   screenshot. No gameplay, no timing.

**Why a debug scenario API over the alternatives:** a separate test Scene would duplicate the
world-wiring we want to exercise; a query-param loader is just a less-flexible front-end to the same
setter. A method call from Playwright's `page.evaluate` reuses the real scene + real systems at the
lowest friction. **Gated on `import.meta.env.DEV`** so `vite build` dead-code-eliminates the install —
`window.game.__test` is genuinely absent from the shipped bundle — which forces the e2e runner to
serve `vite dev` (where `DEV===true`), NOT `vite preview` (production, `DEV===false`). Combat call
sites now take an injectable `rng` (default `Math.random`) so scenarios stay deterministic even if a
future enemy gains `dodge > 0`.

**Two-speed dev loop (the payoff):** inner loop `npm run test:watch` reruns only the unit tests whose
module graph touches the changed file (+ `npx playwright test <one-spec>` when browser fidelity is
needed); wrap-up gate `npm test` + `npm run e2e` + `npm run smoke`. See WORKFLOW.md.
