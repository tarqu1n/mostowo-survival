# Running the Map Builder on your phone (from a cloud Claude session)

How to reach the dev-only [Map Builder](EDITOR.md) from a phone when the editor is
running inside a **Claude Code cloud session** (the ephemeral remote container, not your
own machine). This is the "test the editor on my phone" workflow.

**TL;DR — ask Claude:** _"run the editor on my phone"_, paste an **ephemeral Tailscale
auth key**, and Claude runs [`scripts/phone-editor.sh`](../scripts/phone-editor.sh). It
joins the container to your Tailnet and gives you an IP URL to open on your phone.

## Alternative: run it on an always-on box (no cloud session)

If you have a machine that's always on and already on your Tailnet, host the editor **there**
instead of inside an ephemeral cloud session — then it's just "open the URL", no auth-key dance and
no losing work when a chat goes idle. That's the recommended setup: the editor runs as a Docker
container behind `tailscale serve` (HTTPS), with `EDITOR_AUTOCOMMIT=1` so every save still lands on
GitHub. The `EDITOR_ALLOWED_HOSTS` env var (see `vite.config.ts`) whitelists the proxy's hostname so
Vite doesn't block it. Home-server runbook lives with that box's infra, not here. The rest of this
doc covers the harder **cloud-container** case.

## Why it needs a trick (cloud container only)

The cloud container is a locked box:

- **No inbound.** Nothing on the public internet can reach a port inside it — there is no
  built-in preview/port-forward URL.
- **Outbound is a TLS-only HTTPS `CONNECT` proxy** (`$HTTPS_PROXY`). It forwards a TLS
  handshake to (almost) any host:port, but **drops anything that isn't TLS**, and there is
  **no direct/raw egress at all**.

That combination defeats the usual "share my localhost" tools. Don't re-derive this — it
cost a whole session once:

|Tool|Why it fails here|
|---|---|
|`localtunnel`, `bore`|Data plane is raw TCP to a non-443 port; ignores the proxy → no egress.|
|`cloudflared` (quick tunnel)|Go binary; dials the Cloudflare edge **directly** (`:7844`/`:443`), ignores `HTTPS_PROXY`, and Go bypasses `proxychains` (raw syscalls). Times out.|
|SSH tunnels (`localhost.run`, `serveo`, `pinggy`)|SSH isn't TLS; the proxy kills the connection mid-handshake. Confirmed on `:22` **and** `:443`.|
|`ngrok` (free)|Actually reaches its edge through the proxy — but the free plan **refuses to run behind an HTTP proxy** (`ERR_NGROK_4018` → `ERR_NGROK_9009`). A paid plan would work.|

## What works: put the container on your Tailnet

Instead of exposing the container to the internet, make it a **node on your own Tailnet**.
Your phone is already a Tailnet node, so it reaches the editor **privately**, no public
tunnel. Tailscale's own control-plane + DERP relay traffic is TLS to `*.tailscale.com:443`,
which the proxy is happy to forward, and `tailscaled` honours `$HTTPS_PROXY`. (No direct
UDP here, so WireGuard can't punch through — it relays via DERP over 443. Fine for a GUI.)

### Steps (what the script automates)

1. **You:** generate an **ephemeral** auth key at
   <https://login.tailscale.com/admin/settings/keys> and paste it to Claude.
2. Install Tailscale (apt repo; reachable via the proxy).
3. Start `tailscaled` with `HTTPS_PROXY`/`ALL_PROXY` exported so control-plane + DERP dial
   through the proxy. Use **kernel/TUN mode** when `/dev/net/tun` exists (peers reach the
   local port by IP directly); fall back to `--tun=userspace-networking` + `tailscale serve`
   otherwise.
4. `tailscale up --authkey=… --hostname=mostowo-editor`.
5. Start Vite on all interfaces: `vite --host 0.0.0.0 --port 5173`.
6. Open **`http://<tailscale-ip>:5173/editor.html`** on the phone (`tailscale ip -4`).

### Gotcha: use the IP, not the MagicDNS name

Vite's dev server blocks requests with an unknown **hostname** (DNS-rebinding guard), so
`http://mostowo-editor…ts.net:5173` gets _"Blocked request."_ It **always allows a raw
IP**, so hand out the `100.x.y.z` URL. (Alternative: set `server.allowedHosts` in
`vite.config.ts` — but that's an edit to a committed file; the IP avoids touching it.)

## Saving your work (important — the container is ephemeral)

The editor writes through its dev middleware to **the container's disk**, and the container
is reclaimed on **session inactivity** — measured by _chat_ activity, **not** editor HTTP
traffic. So editing quietly on your phone for a long stretch can let the session go idle and
**lose anything uncommitted**.

**Auto-commit-on-save** solves this: run the editor with `EDITOR_AUTOCOMMIT=1` (the
`scripts/phone-editor.sh` default) and **every editor Save is staged, committed, and pushed**
to the current branch automatically — so each save lands on GitHub and the host can die
without losing more than the edit in flight. Implemented in
[`scripts/vite-editor-api.mjs`](../scripts/vite-editor-api.mjs) (the `/__editor/*` save
middleware): a 2xx mutation schedules a debounced `git add`/`commit`/`push` of the editor's
output paths (`src/data/maps/**`, thumbnails, `asset-catalog.json`, pack `regions`, captured
references). Debounced so a save's map-write + thumbnail-write become one commit; serialized so
bursts never race git; and **off by default** so a normal desktop `npm run editor` never
auto-pushes. Knobs: `EDITOR_AUTOCOMMIT_PUSH=0` (commit locally, don't push),
`EDITOR_AUTOCOMMIT_DEBOUNCE_MS`. `git` push works from the container because it uses a separate
git proxy, not the TLS egress.

Without auto-commit (e.g. `EDITOR_AUTOCOMMIT=0`), fall back to saying **"save"** to Claude at
checkpoints, and ask for periodic **auto-checkpoints** on long sessions.

### Conflicts (diverged branch)

One writer per branch and every push is a clean fast-forward — no conflicts. If the branch is
**also written elsewhere** (another session/device, or a GitHub web edit), a push can be rejected.
The autosave push self-heals: on a non-fast-forward rejection it runs `git pull --rebase
--autostash` to replay the save on top of the remote, then pushes again — which succeeds whenever
the remote touched **different** files. If there's a **true content conflict on the same file**, it
`git rebase --abort`s (restoring a clean, committed state — the save is safe in local history, just
not pushed) and logs a loud `⚠ branch DIVERGED` warning so a human reconciles it, rather than an
unattended process silently mis-merging map JSON. So: don't edit one branch from two places at once;
if you see the divergence warning, reconcile the branch before further saves can push.

## Running the editor locally instead (no cloud, no Tailscale)

If you're on your own machine on the same Wi-Fi as the phone, skip all of the above:
`npm run editor -- --host`, then open `http://<machine-lan-ip>:5173/editor.html` on the phone.
