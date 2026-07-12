# Coding standards

Tooling + naming/TS conventions. For **architecture patterns** (data-driven design, scene wiring,
input gating, worker tasks), see [CONVENTIONS.md](CONVENTIONS.md) — this doc is about *how code is
shaped and checked*, that one's about *how the system is structured*.

## Tooling — what runs where

|Stage|Runs|Scope|
|---|---|---|
|Editor|ESLint + Prettier (flat config `eslint.config.js`, `.prettierrc`)|whatever you're editing|
|Pre-commit hook (`.husky/pre-commit`)|`npx lint-staged`|**staged files only** — fast on any device, incl. phone/short sessions|
|`npm run check`|`typecheck && lint && lint:md && format:check && test`|whole repo|
|CI (`.github/workflows/deploy.yml`)|`npm ci && npm test && npm run build`|whole repo, gates deploy|

- **Escape hatch:** `git commit --no-verify` skips the hook (e.g. mid-refactor WIP on a phone).
  `npm run check` and CI still gate the real thing before it ships.
- The hook is deliberately staged-file-only — no whole-project `tsc` in it. A full typecheck lives in
  `npm run check` and CI, not on every WIP commit.
- Scripts: `lint` / `lint:fix` (ESLint), `lint:md` (markdownlint-cli2), `format` / `format:check`
  (Prettier), `prepare` (installs husky hooks on `npm install` — zero manual setup on a fresh clone,
  per the cross-device rule).
- `lint-staged` (package.json): `*.ts` → `eslint --fix` + `prettier --write`; `*.md` →
  `markdownlint-cli2 --fix` only (no Prettier — see below); `*.{json,css,html}` → `prettier --write`.

## The markdown-is-model-context rule

Every `.md` file here (`CLAUDE.md`, `docs/`, `plans/`) gets loaded into an LLM's context window, often
repeatedly across short sessions. **Write token-lean**, not "readable prose": no padding blank lines,
bare URLs over `<wrapped>`/`[linked](x)` forms, terse bullets over paragraphs, no forced H1/alt-text.
`.markdownlint-cli2.jsonc` enforces the mechanical half of this (rules that ADD characters are off;
rules that STRIP them — trailing spaces, repeat blanks, tight table pipes — stay on). Prettier is
**excluded** from `.md` (its formatter pads blank lines around headings/lists — token bloat);
`markdownlint-cli2 --fix` is the sole markdown formatter.

## TS posture

- `strict` (tsconfig) — no loosening it.
- No `any` without a comment explaining why (ESLint's `no-explicit-any` is `warn`, not `error`, while
  the pre-existing test-harness `any`s get typed properly — see `eslint.config.js`'s `TODO(lint)`).
- Prefer `readonly` fields on data records (`ItemDef`, `NodeDef`, etc.) and narrow interfaces over
  wide ones.
- Comments are **constraints/why, not what** — matches the existing style (see any `src/systems/*.ts`
  header comment for the tone: what invariant holds, what would break it).

## Naming conventions (what the codebase already does)

- **Scene classes:** `PascalCase` + `Scene` suffix, one per lifecycle stage (`BootScene`,
  `PreloadScene`, `MainMenuScene`, `GameScene`, `UIScene`).
- **UI kit components:** `PascalCase` classes (`Button`, `Panel`, `SlotGrid`); shared non-class
  helpers stay lowercase (`layout.ts`, `theme.ts`, `index.ts` barrel).
- **Systems:** lowercase module per concern, named for the domain not the framework (`pathfind.ts`,
  `tasks.ts`, `grid.ts`, `combat.ts`, `daynight.ts`, `needs.ts`); `Inventory.ts` is capitalised because
  it exports a class, not a function bag.
- **Data modules:** lowercase plural nouns for content tables (`items.ts`, `nodes.ts`,
  `buildables.ts`, `enemies.ts`, `weapons.ts`) + `types.ts` (shared schemas) and `tileset.ts`
  (`ACTIVE_TILESET`).
- **Cross-scene events** (`game.events`): `'namespace:action'` string, lowerCamelCase action, e.g.
  `build:toggle`, `combat:attack`, `mode:combatToggle`, `debug:randomise`, `zoom:delta`,
  `tasks:cancel`. Namespaces group by subsystem (`build`, `camera`, `combat`, `debug`, `hunger`,
  `inspect`, `mode`, `needs`, `player`, `tasks`, `time`, `zoom`).
- **Registry keys** (`this.registry`): flat lowerCamelCase strings, no namespace prefix (`hunger`,
  `playerStats`, `inventory`, `following`, `dayPhase`, `dayCount`) — registry holds live state, events
  announce changes to it.

## Commit messages

`type(scope): summary` — `feat`/`fix`/`docs`/`chore`/`refactor`/`tune`, scope is the touched
system/feature (e.g. `feat(monster):`, `fix(daynight):`, `docs(decisions):`). Matches existing git
history; no enforced tooling for this (kept manual — commits are small and reviewed one at a time per
[WORKFLOW.md](WORKFLOW.md)).
