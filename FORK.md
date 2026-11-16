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
   - Thread details limits for CLIProxyAPI threads come from Settings → Usage Providers on any
     connected environment; add it there if the pane still says "Unavailable".

To update later, run `t3-fork-update` again. Options: `-y` skips the quit question, `--force`
reinstalls the current release.

## Rules

- `josh/patches` is rebased onto each new stable tag (`vX.Y.Z`); one commit per patch.
- When upstream ships an equivalent change, the patch is dropped in favour of the official one.
- Patches stay small and client-only. Anything needing server or protocol changes is not carried.
- Builds: push tag `fork-<version>-<n>` (e.g. `fork-0.1.9-1`); `.github/workflows/fork-desktop-mac.yml`
  attaches an unsigned Apple Silicon DMG to a release. The app has no update feed.
- Install or update on the Mac: `fork/t3-fork-update` (quits T3 Code, installs the latest fork release,
  clears quarantine, reopens). The app can't self-update: macOS updates need a signed build.

## Patches

| Patch                                                                   | Upstream                   | Drop when                                          |
| ----------------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Thread details show pooled CLIProxyAPI hub limits for proxied providers | issue #30990               | upstream pane shows hub limits for proxied threads |
| Restore macOS cursor auto-hide while typing                             | reverts part of c2d44a312c | upstream hides the cursor while typing             |
| Bindable `chat.citeSelection` command                                   | PR #34656                  | that PR or an equivalent merges                    |
| "Open in new threads" setting for Thread details                        | PR #25598                  | that PR or an equivalent merges                    |
| ⌘⌥←/→ switch to the next/previous right panel tab                       | PR #34437                  | that PR or an equivalent merges                    |
| ⌘⌥1–9 jump to a right panel tab (9 = last)                              | none (fork-only)           | upstream ships tab jump shortcuts                  |
