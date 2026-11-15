# andromidasj/t3code

A personal fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) that carries a few small
client-side patches on top of each **stable** upstream release. Only the macOS desktop app is built
from it; servers stay on official releases.

## Rules

- `josh/patches` is rebased onto each new stable tag (`vX.Y.Z`); one commit per patch.
- When upstream ships an equivalent change, the patch is dropped in favour of the official one.
- Patches stay small and client-only. Anything needing server or protocol changes is not carried.
- Builds: push tag `fork-<version>-<n>` (e.g. `fork-0.1.9-1`); `.github/workflows/fork-desktop-mac.yml`
  attaches an unsigned Apple Silicon DMG to a release. The app has no update feed.

## Patches

| Patch                                                                   | Upstream                   | Drop when                                          |
| ----------------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| Thread details show pooled CLIProxyAPI hub limits for proxied providers | issue #30990               | upstream pane shows hub limits for proxied threads |
| Restore macOS cursor auto-hide while typing                             | reverts part of c2d44a312c | upstream hides the cursor while typing             |
| Bindable `chat.citeSelection` command                                   | PR #34656                  | that PR or an equivalent merges                    |
| "Open in new threads" setting for Thread details                        | PR #25598                  | that PR or an equivalent merges                    |
