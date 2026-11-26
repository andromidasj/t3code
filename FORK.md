# andromidasj/t3code

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) that carries a few small
client-side patches on top of each **stable** upstream release. Only the macOS desktop app is built
from it; servers stay on official releases.

## Set up a Mac

Apple Silicon only. Works whether or not the official app is installed; it replaces it in place and
keeps your sign-in, settings and threads.

1. Install the updater (once per Mac), then open a new Terminal window:

   ```bash
   mkdir -p ~/.local/bin && curl -fsSL https://raw.githubusercontent.com/andromidasj/t3code/josh/patches/fork/t3-fork-update -o ~/.local/bin/t3-fork-update && chmod +x ~/.local/bin/t3-fork-update && { grep -q '.local/bin' ~/.zshrc 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc; }
   ```

2. Run `t3-fork-update`. It asks before quitting T3 Code, installs the latest fork release, and
   reopens it.
3. Approve the keychain prompt if one appears (the build is unsigned, so it can come back after each
   update). Re-grant microphone or screen-recording access if T3 Code asks. Sign in to T3 Connect
   with the browser option; passkeys need T3's own signed build.
4. Per-Mac settings the fork adds:
   - Settings → Keybindings: bind `chat.citeSelection` (e.g. ⌘L).
   - Settings → Appearance → Thread details: untick "Open in new threads".
   - Settings → Labs → Customizations: which pages sit at the top of the sidebar (Board, Pull
     requests, Issues) and in what order, where this Mac's bot board lives (saved on this Mac
     only) and whether the app opens on the Board. The bot board is bot-desk `board.py`'s
     output: its web address (e.g. `https://host:8447/`) or its folder on this Mac (e.g.
     `~/dev/bot/.board`). The desktop app reads `data.json` there, or the data `index.html` embeds.
     "Collapse routine bot updates" (on by default) folds finished agent-to-agent and scheduled
     turns into one "Bot activity" strip; running, failed, waiting and 👉 turns stay open.
     "Sidebar filter and Bot / Background" (on by default) adds All | Mine | Needs me under the
     sidebar's pages and folds threads bots started that you never wrote in (no 👉 title, nothing
     waiting on you) into a collapsible Bot / Background shelf above Snoozed and Settled. Shift-,
     ⌘- or Ctrl-click in the sidebar's project menu picks several projects; with projects
     picked, "Save view" keeps that set as a chip; rename or delete views here.
   - Board: the header's View and Group menus pick what shows. Needs me counts live threads
     waiting on you plus ready bot-desk items, the same number as the sidebar's Board button and
     the bot chips; items not ready yet and later ones fold below it. Group (kept on this Mac)
     sorts ready items by priority, type, bot or not at all.
   - Settings → Scheduled tasks: each task's Delivery (Silent, Updates only, Always) is stored as a
     trailing `[t3-delivery: <mode>]` line on its prompt, which the agent reads and the app hides.
     Silent and Updates only skip the "Thread completed" notice for that task's runs on this Mac;
     failures, approvals and questions still notify. Unmarked tasks notify as before.
     The Board's Jobs view, and the Scheduled jobs strip at the bottom of All (open while a job
     fails), list every connected environment's tasks, failed first, with Delivery, Run now and
     Edit; the bot filter narrows them to that desk's projects.
   - Thread details limits for CLIProxyAPI threads (official since 0.1.12) come from Settings →
     Usage Providers; the hub's URL there must use the same host and port as the provider's base
     URL, or the pane says "Unavailable".

To update later, run `t3-fork-update` again. Options: `-y` skips the quit question, `--force`
reinstalls the current release.

## Rules

- `josh/patches` is rebased onto each new stable tag (`vX.Y.Z`); one commit per patch.
- When upstream ships an equivalent change, the patch is dropped in favour of the official one.
- Patches stay small and client-only. Anything needing server or protocol changes is not carried.
- Larger fork-only features live in `apps/web/src/fork/` and `apps/desktop/src/fork/`; upstream
  files get only short glue edits, so a rebase conflicts in a few lines at most.
- Builds: push tag `fork-<version>-<n>` (e.g. `fork-0.1.9-1`); `.github/workflows/fork-desktop-mac.yml`
  attaches an unsigned Apple Silicon DMG to a release. The app has no update feed.
- Install or update on the Mac: `fork/t3-fork-update` (quits T3 Code, installs the latest fork release,
  clears quarantine, reopens). The app can't self-update: macOS updates need a signed build.

## Patches

| Patch                                             | Upstream                   | Drop when                              |
| ------------------------------------------------- | -------------------------- | -------------------------------------- |
| Restore macOS cursor auto-hide while typing       | reverts part of c2d44a312c | upstream hides the cursor while typing |
| Bindable `chat.citeSelection` command             | PR #34656                  | that PR or an equivalent merges        |
| "Open in new threads" setting for Thread details  | PR #25598                  | that PR or an equivalent merges        |
| ⌘⌥←/→ switch to the next/previous right panel tab | PR #34437                  | that PR or an equivalent merges        |
| ⌘⌥1–9 jump to a right panel tab (9 = last)        | none (fork-only)           | upstream ships tab jump shortcuts      |
| PR links open via any environment with the repo   | none (fork-only)           | upstream resolves links across envs    |
| Board view (`/board`, ⌥⇧⌘B) and per-Mac settings  | none (fork-only)           | upstream ships a cross-thread board    |
| Board shows bot-desk items, Today and details     | none (fork-only)           | the Board patch is dropped             |
| Board right panel, sidebar pages, "Open in" desk  | none (fork-only)           | the Board patch is dropped             |
| Collapse routine bot updates in threads           | none (fork-only)           | upstream folds agent-to-agent turns    |
| Scheduled task delivery modes                     | none (fork-only)           | upstream ships per-task notify modes   |
| Sidebar All/Mine/Needs me, Bot / Background       | none (fork-only)           | upstream separates bot threads         |
| Scheduled jobs health on the Board (Jobs)         | none (fork-only)           | the Board patch is dropped             |
