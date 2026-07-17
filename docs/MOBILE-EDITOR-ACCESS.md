# Working on the game from your phone

Two separate things you can do from a phone, and how they interact in git:

1. **Run the [Map Builder](EDITOR.md)** — paint maps in the browser. Hosted on the home server
   (**guppi**), always on; you just open a URL. See [Map Builder on guppi](#map-builder-on-guppi-recommended).
2. **Run a Claude Code chat** — change game *code* (or fix git) from a phone, inside a cloud
   container. See [Claude Code from a phone](#claude-code-from-a-phone--git-conflicts).

Both can push to `master`, so the last section is the **git-conflict playbook** — read it before you
edit the same thing from two places at once.

## Map Builder on guppi (recommended)

The editor runs as a Docker container on guppi behind `tailscale serve` (HTTPS), with
`EDITOR_AUTOCOMMIT=1` so every Save commits+pushes to `master`. It's **always on and already on the
Tailnet**, so from a phone (on the Tailnet) it's just:

```text
https://guppi-eq.tailfba8be.ts.net:8444/editor.html
```

No auth-key dance, no losing work when a chat goes idle. That's the whole workflow — open it and paint.

- **Infra lives with guppi**, not here: the compose/deploy/runbook is in the `guppi` repo at
  `services/mostowo-editor.md` (+ `mostowo-editor/`). This doc is the game-side view.
- **Tailnet-only.** The container is published on `127.0.0.1` and only reachable via `tailscale
  serve` — so the phone must be on the Tailnet. There is no LAN/public URL by design.
- **`EDITOR_ALLOWED_HOSTS`** (read by `vite.config.ts`) whitelists the serve hostname; Vite's
  dev-server host check would otherwise return *"Blocked request."* for the proxied `Host` header.
  guppi's compose sets it to the serve host. (A raw Tailnet IP is always allowed by Vite, so
  `http://<guppi-tailnet-ip>:5173/editor.html` also works if the port is published on the Tailnet
  interface — but the HTTPS serve URL is the intended one.)

## Auto-commit-on-save (how a save reaches GitHub)

Opt-in via `EDITOR_AUTOCOMMIT=1` (guppi sets it; a normal desktop `npm run editor` never
auto-pushes). Implemented in [`scripts/vite-editor-api.mjs`](../scripts/vite-editor-api.mjs) (the
`/__editor/*` save middleware): a 2xx mutation schedules a debounced `git add`/`commit`/`push` of the
editor's output paths only (`src/data/maps/**`, thumbnails, `asset-catalog.json`, pack `regions`,
captured references). Debounced so a save's map-write + thumbnail-write coalesce into one commit;
serialized so bursts never race git. Knobs: `EDITOR_AUTOCOMMIT_PUSH=0` (commit locally, don't push),
`EDITOR_AUTOCOMMIT_DEBOUNCE_MS`.

So each Save lands on `master` on GitHub within a second or two — the host can be rebuilt without
losing more than the edit in flight.

## Claude Code from a phone + git conflicts

You'll sometimes want a **Claude Code chat on the phone** to change game code, or to fix a git mess.
That chat runs in an **ephemeral cloud container** with its **own clone** of the repo. The thing to
internalise is that there are now **two clones that both push to `master`**:

|Clone|Where|Pushes|Reconcile it…|
|---|---|---|---|
|**Editor**|guppi (`/home/guppi/mostowo-editor/repo`, = `/app` in container `mostowo-editor`)|map/asset JSON on every Save|**on guppi** (its commits are local until pushed)|
|**Phone Claude**|the cloud container|whatever code you change|in that container (normal git)|

### What's automatic vs what needs you

- **Different files** (the normal case — editor writes map JSON, a code session writes `src/`):
  the autosave push **self-heals**. On a non-fast-forward rejection it runs `git pull --rebase
  --autostash` and pushes again, which succeeds when the two sides touched different files. Nothing
  for you to do.
- **Same file, both sides** (rare — e.g. a code session hand-edits a `*.map.json` the editor is also
  writing): the autosave `git rebase --abort`s (leaving a **clean, committed state** — your save is
  safe in local history, just unpushed) and logs a loud **`⚠ branch DIVERGED`**. Now a human decides.

The **first golden rule** makes the second case almost never happen: **don't edit the same files from
two places at once.** Paint maps in the editor *or* hand-edit map JSON in a code session — not both
against `master` simultaneously.

### Conflicts in the phone Claude clone (the easy case)

If your phone code-session's own `git push` is rejected because the editor moved `master`, that's
**ordinary git** — Claude in that container has full file tools, so just have it
`git pull --rebase`, resolve, and push. guppi's editor clone then rebases cleanly on its next Save.
No guppi access needed.

### Fixing the stuck editor commit on guppi (the `⚠ DIVERGED` case)

This is the one that needs a shell **on guppi**, because the unpushed autosave commit only exists
there. To reach guppi from a phone Claude container you need it **on the Tailnet** (see the
[cloud-container Tailnet steps](#fallback-host-the-editor-in-a-cloud-container) — same `tailscale up`
flow) **and** able to SSH in. guppi's sshd is key-only and the container has no key, so use
**Tailscale SSH**:

```bash
# from the phone container, once it's on the Tailnet:
tailscale ssh guppi@guppi-eq.tailfba8be.ts.net   # 'tailscale ssh' works even in userspace-net mode
```

> **One-time prerequisite (your call — it's a security tradeoff).** Tailscale SSH is **not** enabled
> on guppi yet. Enabling it lets Tailnet peers your ACL allows shell into guppi (which runs
> Vaultwarden, HA, …) with **no key** — convenient, but broad. If you want it, keep it least-privilege:
> enable on guppi with `sudo tailscale up --ssh`, and in the Tailnet **ACL** grant SSH to guppi only
> from **your own user** (not a wide tag), then join the phone container with a **short-lived
> ephemeral** auth key and remove the node when done. If you'd rather not open guppi to containers at
> all, do this reconcile from a device that already has guppi SSH (your Mac) when you're next on it.

Once you have a shell on guppi, run git **inside the container** (it already has the deploy key +
`GIT_SSH_COMMAND` wired, and the right uid):

```bash
# inspect
docker exec mostowo-editor sh -c 'cd /app && git fetch origin && \
  git log --oneline --left-right HEAD...origin/master'

# Simplest fix — drop the stuck local map commit, take the remote, then REDO that one
# edit in the editor (map JSON is cheap to re-author; nothing else is lost):
docker exec mostowo-editor sh -c 'cd /app && git reset --hard origin/master'

# Or, to KEEP the exact commit, rebase it onto the moved master and fix the clashing file:
docker exec -it mostowo-editor sh -c 'cd /app && git pull --rebase --autostash origin master'
#   …edit the conflicted file, then:
docker exec -it mostowo-editor sh -c 'cd /app && git add -A && git rebase --continue && git push'
```

After either fix the `⚠ DIVERGED` state clears and normal autosave-pushes resume.

> **Want to avoid guppi-shell reconciles entirely?** The autosave could, on a same-file conflict,
> push the stuck commit to a side branch (e.g. `editor-conflict/…`) instead of leaving it local —
> then any clone (your phone Claude container) reconciles it against `master` with normal git, no
> guppi access. It's a small change to `pushWithRebase` in `vite-editor-api.mjs`; not built yet.

## Fallback: host the editor in a cloud container

Only when guppi is down / unreachable and you still need the editor: host it **inside the phone's
Claude Code cloud session** instead. **Ask Claude:** *"run the editor on my phone"*, paste an
**ephemeral Tailscale auth key**, and it runs [`scripts/phone-editor.sh`](../scripts/phone-editor.sh),
which joins the container to your Tailnet and prints an IP URL. This is harder than the guppi path
because the cloud container is a locked box:

- **No inbound.** Nothing on the public internet can reach a port inside it — no preview URL.
- **Outbound is a TLS-only HTTPS `CONNECT` proxy** (`$HTTPS_PROXY`): it forwards a TLS handshake to
  (almost) any host:port but **drops anything that isn't TLS**, with no raw egress.

That defeats the usual "share my localhost" tools. Don't re-derive this — it cost a whole session:

|Tool|Why it fails here|
|---|---|
|`localtunnel`, `bore`|Data plane is raw TCP to a non-443 port; ignores the proxy → no egress.|
|`cloudflared` (quick tunnel)|Go binary; dials the Cloudflare edge **directly** (`:7844`/`:443`), ignores `HTTPS_PROXY`, and Go bypasses `proxychains`. Times out.|
|SSH tunnels (`localhost.run`, `serveo`, `pinggy`)|SSH isn't TLS; the proxy kills it mid-handshake. Confirmed on `:22` **and** `:443`.|
|`ngrok` (free)|Reaches its edge through the proxy, but the free plan **refuses to run behind an HTTP proxy** (`ERR_NGROK_4018` → `9009`). Paid would work.|

**What works: put the container on your Tailnet.** Tailscale's control-plane + DERP relay is TLS to
`*.tailscale.com:443`, which the proxy forwards, and `tailscaled` honours `$HTTPS_PROXY`. What the
script does:

1. **You:** generate an **ephemeral** key at <https://login.tailscale.com/admin/settings/keys>.
2. Install Tailscale (apt repo; reachable via the proxy).
3. Start `tailscaled` with `HTTPS_PROXY`/`ALL_PROXY` exported. Kernel/TUN mode when `/dev/net/tun`
   exists (peers reach the local port by IP directly); else `--tun=userspace-networking` +
   `tailscale serve`.
4. `tailscale up --authkey=… --hostname=mostowo-editor`.
5. Start Vite on all interfaces: `vite --host 0.0.0.0 --port 5173` (with `EDITOR_AUTOCOMMIT=1`).
6. Open **`http://<tailscale-ip>:5173/editor.html`** on the phone (`tailscale ip -4`).

**Gotcha: use the IP, not the MagicDNS name.** Vite blocks requests with an unknown *hostname*
(DNS-rebinding guard) — `http://mostowo-editor…ts.net:5173` gets *"Blocked request."* — but **always
allows a raw IP**, so hand out the `100.x.y.z` URL. (Or set `EDITOR_ALLOWED_HOSTS`, as guppi does.)

The container is **ephemeral** — reclaimed on chat inactivity (measured by *chat* activity, not
editor HTTP traffic). `EDITOR_AUTOCOMMIT=1` is what makes that safe: each Save is already on GitHub.
Without it, say **"save"** to Claude at checkpoints.

## Running the editor locally instead (no cloud, no Tailscale)

On your own machine on the same Wi-Fi as the phone, skip all of the above: `npm run editor -- --host`,
then open `http://<machine-lan-ip>:5173/editor.html` on the phone.
