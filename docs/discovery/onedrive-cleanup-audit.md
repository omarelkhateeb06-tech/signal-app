# OneDrive Cleanup Mini-Session — Stage 1 discovery audit

**Date:** 2026-04-28
**HEAD at start:** `d5d6201 docs(claude): housekeeping cluster — shell-env trap + numbering hygiene notes (#57)` on `discovery/onedrive-cleanup` (worktree spawned canonical-rooted at `C:/dev/signal-app/.claude/worktrees/onedrive-cleanup`)
**Scope:** read-only audit for Items #4 (OneDrive-nested spawn-path) and #5 ("leftover" worktree directories) of the post-12e.5b housekeeping cluster.

---

## 1. Filesystem inventory

### Top-level contents of `C:\dev\signal-app\OneDrive\`

```
OneDrive/
└── Desktop/
    └── signal-app/
        └── .claude/
            └── worktrees/
                ├── epic-banach-de0c78/      (empty dir, 4K)
                ├── jolly-elgamal-d5ef7f/    (empty dir, 0)
                ├── lucid-williams-b3a2c7/   (empty dir, 4K)
                └── zealous-lumiere-45dbae/  (empty dir, 4K)
```

### Full-clone-vs-worktree classification — surprising finding

`C:\dev\signal-app\OneDrive\Desktop\signal-app\` is **NOT a git clone or a worktree**. There is no `.git/` directory and no `.git` file at that path. The only thing under it is an empty `.claude\worktrees\` subdirectory containing four empty subdirectories.

`Get-Item C:\dev\signal-app\OneDrive\Desktop\signal-app\.git` → file does not exist (verified via `test -f` and `test -d`, both false).

### Worktree subdirectory count under nested `.claude\worktrees\`

**4 subdirectories** (the brief listed 2 — see §7 flag):
- `epic-banach-de0c78/` — empty, 4K (this session's CWD; PID 37036)
- `jolly-elgamal-d5ef7f/` — empty, 0K (sibling session; PID 37796)
- `lucid-williams-b3a2c7/` — empty, 4K (sibling session; PID 39972)
- `zealous-lumiere-45dbae/` — empty, 0K (sibling session; PID 2480)

Every subdirectory is a pure empty directory shell — no `.git` file/dir, no source code, no config, just `.` and `..`.

### Total size of nested tree

**20 KB total.** The "nested clone" framing is misleading — this is a 20K directory shell, not a code-bearing clone. Cleanup is not about disk space.

---

## 2. Worktree map

### Full `git worktree list` (verbatim)

```
C:/dev/signal-app                                        d5d6201 [main]
C:/dev/signal-app/.claude/worktrees/housekeeping-cluster 0381664 [discovery/housekeeping-cluster]
C:/dev/signal-app/.claude/worktrees/onedrive-cleanup     d5d6201 [discovery/onedrive-cleanup]
```

### Canonical-rooted vs OneDrive-rooted count

- **Canonical-rooted:** 3 of 3 (canonical clone itself + 2 active worktrees).
- **OneDrive-rooted:** 0 of 3.

`git worktree list` does not see ANY OneDrive-nested directory as a worktree. That's because none of them have `.git` files pointing back to a worktree admin record in `.git/worktrees/`.

### Status of `epic-banach-de0c78` and `lucid-williams-b3a2c7`

Both **disk-only**, no git tracking:
- `.git/worktrees/epic-banach-de0c78/` — does not exist (admin pruned).
- `.git/worktrees/lucid-williams-b3a2c7/` — does not exist (admin pruned).

Same for the two unlisted leftovers (`jolly-elgamal-d5ef7f`, `zealous-lumiere-45dbae`): also admin-pruned, also disk-only.

### Branches still pointing at leftover SHAs

- `ee6e8d4` (epic-banach pre-squash WIP commit): **NOT reachable from main** (`git merge-base --is-ancestor ee6e8d4 main` → exit 1). Expected: that commit was on the pre-squash PR #56 branch, which got squashed to `bd1bacd` on merge.
- `e97bc35` (lucid-williams 12e.5a commit): **reachable from main** (exit 0). Folded into the squash-merge.

Local branches still pointing at jolly-elgamal-d5ef7f and zealous-lumiere-45dbae naming pattern:

```
claude/jolly-elgamal-d5ef7f
claude/zealous-lumiere-45dbae
```

These two branches still exist locally. The other two (`claude/epic-banach-de0c78`, `claude/lucid-williams-b3a2c7`) are gone — deleted during PR #56 / PR #55 merge cleanup.

---

## 3. Harness configuration source

### `C:\dev\signal-app\.claude\settings.local.json` (canonical, 1485 bytes)

Contains a `permissions.allow` array for Bash commands. **No worktree-path configuration.** No `cwd`, `workingDirectory`, `worktreePath`, or similar key. Pure permissions config.

### `C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\` (nested)

Contains only `worktrees/` subdirectory. **No `settings*.json` file at all.**

### `~\.claude\settings.json` (user-global, 768 bytes)

Permissions config (allow + deny lists for Bash). **No worktree-path configuration.** Includes `Bash(git worktree:*)` in `allow` and several destructive commands in `deny` (`git reset --hard:*`, `git clean:*`, `Remove-Item:*`, etc).

### Other `settings*.json` found

```
/c/dev/signal-app/.claude/settings.local.json    (canonical, inspected above)
/c/dev/signal-app/node_modules/bcryptjs/.vscode/settings.json     (vendored, irrelevant)
/c/dev/signal-app/node_modules/resolve/.claude/settings.local.json (vendored, irrelevant)
```

No user-authored config beyond the two already covered.

### Environment variables matching `CLAUDE|WORKTREE`

```
CLAUDE_CODE_EMIT_TOOL_USE_SUMMARIES=false
CLAUDE_CODE_ENABLE_ASK_USER_QUESTION_TOOL=true
CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1
CLAUDECODE=1
CLAUDE_AGENT_SDK_VERSION=0.2.119
CLAUDE_CODE_DISABLE_CRON=
CLAUDE_CODE_CLASSIFIER_SUMMARY=0
CLAUDE_CODE_ENTRYPOINT=claude-desktop
CLAUDE_CODE_OAUTH_TOKEN=<REDACTED — see §7 flag>
CLAUDE_CODE_RATE_LIMIT_TIER=default_claude_max_5x
CLAUDE_CODE_EXECPATH=C:\Users\elkha\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\2.1.119\claude.exe
CLAUDE_CODE_SUBSCRIPTION_TYPE=max
CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1
PWD=/c/dev/signal-app/OneDrive/Desktop/signal-app/.claude/worktrees/epic-banach-de0c78
```

`PWD` is the operative variable — it's the bash inheritance of the harness's session CWD. **No `CLAUDE_CODE_WORKTREE_PATH` or similar — no env var explicitly controls spawn location.**

### Identified spawn-path control mechanism

**Source of truth: `~\.claude\sessions\<pid>.json`** — one file per running CC session, written by the harness at session start. Each file contains a `cwd` field that pins the bash subprocess's working directory. The four currently-live sessions:

```
PID  2480  cwd=C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\zealous-lumiere-45dbae
PID 37036  cwd=C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\epic-banach-de0c78    ← current session
PID 37796  cwd=C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\jolly-elgamal-d5ef7f
PID 39972  cwd=C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\lucid-williams-b3a2c7
```

The `cwd` is set at session start by the `claude-desktop` entrypoint and is not user-configurable through any settings file inspected. It appears to be **inherited from the user's invocation CWD** when they launched Claude Desktop, persisted into a per-session state file, and then enforced as the bash CWD for every command in that session.

There is also `~\.claude\projects\<encoded-cwd>\` — a project-state directory whose name encodes the session CWD path. The directory is created on-demand the first time a session starts in a given CWD. Currently 14 such project-state dirs exist for various pre-flatten and post-flatten paths.

### Recommended config change for Stage 2 (proposal — not applied)

There is **no config-file-controlled spawn path to change**. The fix isn't a config write; it's an invocation-time discipline change. Two non-exclusive paths:

1. **Invoke `claude-desktop` from `C:\dev\signal-app\` (canonical) instead of from any OneDrive-nested path.** Future sessions will pin their CWD to canonical and `git worktree add` will land worktrees under `C:\dev\signal-app\.claude\worktrees\` (correct location). This requires changing the user's launch habit — pinning a Windows shortcut, or ensuring Claude Desktop's "open in folder" picks canonical.
2. **Optional: clean up the 14 stale project-state dirs at `~\.claude\projects\C--Users-elkha-OneDrive-Desktop-signal-app...`** — they're harmless but accumulating. Each holds a session transcript `.jsonl` that may have grown to multiple MB.

Stage 2 is NOT a settings-file edit. It's: (a) terminate the 3 sibling CC sessions, (b) delete the 4 empty OneDrive-nested directories, (c) document the canonical-invocation discipline in CLAUDE.md, (d) wait for OneDrive sync to finish before deleting (or stop OneDrive temporarily).

---

## 4. OneDrive process state

```
Image Name:   OneDrive.exe
PID:          27384
Mem Usage:    776,600 K (~776 MB)
Session#:     1
```

OneDrive is **running and healthy** (~776MB memory, not paused). The lock-handle assumption from the brief (OneDrive holds file handles on synced paths and prevents `git worktree remove` from cleaning up) is consistent with this. `handle.exe` was not run (not preinstalled), so direct handle enumeration was skipped per brief instruction.

Note: with OneDrive nested-tree being only 20K of empty directory shells, the lock-handle problem is minor — OneDrive can briefly hold a directory open during sync, but there's no node_modules tree to lock here. The original lock-handle problem mentioned in the brief likely surfaced during pre-flatten work when actual `node_modules/` lived under the OneDrive-synced path; today's lock surface is much smaller.

---

## 5. Active session / risk inventory

### Live CC sessions (4)

All four `claude.exe` processes are currently running:

| PID | session start (UTC) | cwd | git-side branch matching |
|---|---|---|---|
| 2480 | 2026-04-27T13:29:53 | `…\worktrees\zealous-lumiere-45dbae` | `claude/zealous-lumiere-45dbae` exists |
| 37036 | 2026-04-28T12:45:33 | `…\worktrees\epic-banach-de0c78` | (branch deleted post-PR #56) — **THIS session** |
| 37796 | 2026-04-27T16:17:24 | `…\worktrees\jolly-elgamal-d5ef7f` | `claude/jolly-elgamal-d5ef7f` exists |
| 39972 | 2026-04-27T22:19:41 | `…\worktrees\lucid-williams-b3a2c7` | (branch deleted post-PR #55) |

**Critical correction to the brief:** the brief framed `epic-banach-de0c78` and `lucid-williams-b3a2c7` as "leftover worktree directories that survived `worktree remove` on disk." That's only half right. They survived as directories, yes — but they're also **CWDs of currently-live CC sessions**. Item #5 of the cluster framing was based on the assumption that these are dead. They are alive. See §7.

### Worktrees with unmerged work (real worktrees, canonical-rooted)

`git branch --no-merged main`:

```
audit/phase12e3-stage1-discovery
audit/phase12e4-stage1-discovery
chore/phase12e2-smoke-test
discovery/housekeeping-cluster      (current PR #57 — merged, but local ref un-pruned?)
feat/12e2-rss-adapter
fix/0012-fresh-db-bootstrap
phase-12e/01-schema-and-scaffolding
refactor/tier-rename-and-default
restructure/flatten-onedrive-nesting
```

9 branches with commits not on main. Most are likely residue from earlier merged PRs (the PR was squashed; the local branch's commits aren't directly reachable). Specifically:

- `restructure/flatten-onedrive-nesting`: appears squashed-merged into main as `b62050b refactor: flatten OneDrive/Desktop/signal-app/ path prefix (#45)` — the local branch is residue.
- `discovery/housekeeping-cluster`: PR #57 just merged at `d5d6201`, local ref un-pruned.

None of these branches are on the OneDrive-nested CWDs (which have no `.git`, so no branch checkout there). They're pure local-branch residue.

### Local-only branches (not on origin)

`git branch --no-merged main` ∩ `git branch -r` complement → likely all 9 above except those re-checked. **Stage 2 must not assume "branch deletable" without per-branch reachability check.** None of them blocks the OneDrive-cleanup work directly, but a separate worktree-hygiene pass should sweep them.

### Coordination flags for Stage 2

- **THIS session (PID 37036, epic-banach) cannot delete its own CWD without breaking itself.** Plan must defer that one specific directory until session ends.
- **Three sibling sessions (PIDs 2480, 37796, 39972) are alive.** Their CWDs cannot be deleted without breaking their bash subprocesses. Stage 2 must either:
  - (a) ask user to close those three CC desktop windows first, then proceed, OR
  - (b) accept that those three dirs survive Stage 2 and get cleaned up in a follow-up after sessions end.
- The cleanup is **not safe to "blast through"** even if all four dirs are empty and 20K total.

---

## 6. Stage 2 plan proposal

Recommended sequence — small, ordered, each step reversible until the destructive deletes:

1. **Confirm session inventory.** Re-run `Get-ChildItem ~\.claude\sessions\*.json | Get-Content` and compare against `tasklist | findstr claude.exe`. Confirm that the 4 sessions in `~\.claude\sessions\` still match 4 live `claude.exe` PIDs. If any of the 4 has terminated since this audit, mark its dir as "safe to delete now."
2. **Ask user to close the 3 sibling CC sessions** (`zealous-lumiere`, `jolly-elgamal`, `lucid-williams`). The user controls this from Claude Desktop UI. **Validation checkpoint:** `tasklist /FI "IMAGENAME eq claude.exe"` should show only 1 `claude.exe` (the current epic-banach session). If still showing more, stop and re-prompt. **Rollback:** trivial — user can just restart any session.
3. **Pause OneDrive sync** for `C:\dev\signal-app\` (right-click OneDrive tray → "Pause syncing → 2 hours"). Prevents lock-handle conflicts during deletes. **Validation:** OneDrive icon shows paused state. **Rollback:** unpause sync; trivial.
4. **Delete the 3 sibling empty dirs** (`zealous-lumiere-45dbae`, `jolly-elgamal-d5ef7f`, `lucid-williams-b3a2c7`) via `Remove-Item -Recurse -Force`. They're 20K of empty subdirs; if anything resists deletion, OneDrive is still locking. **Validation:** `Get-ChildItem C:\dev\signal-app\OneDrive\Desktop\signal-app\.claude\worktrees\` should show only `epic-banach-de0c78`. **Rollback:** none possible (deleted), but the dirs are empty — nothing of value lost.
5. **Delete the matching `claude/jolly-elgamal-d5ef7f` and `claude/zealous-lumiere-45dbae` local branches** (their associated PRs are long-merged). `git branch -D <name>` on canonical. **Validation:** `git branch | findstr "jolly-elgamal\|zealous-lumiere"` → empty. **Rollback:** git's reflog still has the branch tip SHAs for ~30 days; restorable if needed.
6. **Add a CLAUDE.md note in §14 (Worktree hygiene)** documenting: invoke `claude-desktop` from `C:\dev\signal-app\` only; avoid OneDrive-nested CWDs; if a session's CWD ends up under `\OneDrive\`, end and restart from canonical. This is the prevention measure. **Validation:** `Select-String CLAUDE.md -Pattern 'OneDrive'` should return matches. **Rollback:** trivial revert.
7. **Schedule a follow-up to delete `epic-banach-de0c78\`** once THIS session ends. Could be a one-line cleanup script the user runs on next CC start, or a manual `Remove-Item` after Claude Desktop is closed. Document explicitly so it doesn't get lost.
8. **Optional:** delete the 14 stale `~\.claude\projects\C--Users-elkha-OneDrive-...` project-state directories (one per pre-flatten session). They're transcript archives, possibly multi-MB each. **Validation:** `(Get-ChildItem ~\.claude\projects\ | Measure-Object).Count` drops to expected ≤4. **Rollback:** none — transcripts are gone.

**Estimated duration:** 15–25 minutes once the user closes the 3 sibling sessions. Step 2 (closing sessions) is the only step that requires user action; steps 4 and 5 are sub-second once OneDrive is paused.

**Out-of-scope but adjacent:** the 9 unmerged-to-main local branches (`restructure/flatten-onedrive-nesting`, `audit/phase12e3-stage1-discovery`, etc.) are residue from squash-merged PRs. A separate worktree-hygiene pass per CLAUDE.md §14 should clean those up; not part of OneDrive cleanup specifically.

---

## 7. Open questions / flags for planner

### Critical / security flag

- **`CLAUDE_CODE_OAUTH_TOKEN` was emitted to chat output during this audit.** When I ran `env | grep -iE 'claude|worktree'` for §C5, the env value of `CLAUDE_CODE_OAUTH_TOKEN` (an `sk-ant-oat01-...` bearer token) was printed in the bash tool result and is now visible in the chat scrollback. It is **not** included in this audit doc (redacted in §3). This is the harness's own auth token, not a user-side credential — but it's still a real bearer that the conversation now persists. **The user may want to rotate it.** I will not re-echo the value here. The exposure was a side-effect of doing an `env` dump per the brief's §C5 instruction; future env-inspection patterns should filter `CLAUDE_CODE_OAUTH_TOKEN` (and any `*_TOKEN`, `*_KEY`, `*_SECRET`) before output.

### Brief framing inaccuracies (worth correcting in Stage 2 messaging)

- **Item #5 said "two leftover worktree directories" — actually four directories, and "leftover" is misleading.** The four directories under the OneDrive-nested `.claude\worktrees\` are not leftovers — they are CWDs of four currently-running CC sessions (PIDs 2480, 37036, 37796, 39972). Three siblings are live; one (37036) is this very session. Stage 2 sequencing must coordinate session shutdown.
- **Item #4 said "the nested OneDrive clone" — there is no clone.** The nested path is a 20K empty-directory tree, not a code-bearing clone. There is no `.git/` directory or `.git` file at `C:\dev\signal-app\OneDrive\Desktop\signal-app\` or anywhere under it. Cleanup is conceptually closer to "remove four empty dirs and one wrapper dir" than "delete a duplicate clone."
- **PR #45 was merged.** The local `restructure/flatten-onedrive-nesting` branch is squash-merged residue (`b62050b` on main). Brief implied PR #45 work might still be in flight; it's done. The remaining cleanup is post-#45 sediment.

### Surprises / non-obvious findings

- **Spawn-path control is not config-file-driven.** Searches across canonical `.claude\settings.local.json`, OneDrive-nested `.claude\` (no settings file), `~\.claude\settings.json`, and every `settings*.json` reachable from `C:\dev\signal-app\` (excluding `node_modules/`) yielded zero keys controlling worktree spawn or session CWD. The actual mechanism is `~\.claude\sessions\<pid>.json`'s `cwd` field, set at session start by Claude Desktop, derived from invocation CWD. Stage 2's "config change" framing should be replaced with "invocation-discipline change" and a CLAUDE.md note.
- **`~\.claude\projects\` has 14 stale pre-flatten project-state directories** plus 2 post-flatten ones. They survived PR #45's flatten (which only moved code, not session state). Optional cleanup target — multi-MB `.jsonl` transcripts inside.
- **OneDrive lock-handle problem is much smaller than the brief implied.** The dirs are empty (20K total). OneDrive may briefly lock a parent dir during sync, but there's no `node_modules/` here to lock. Pausing OneDrive during the deletes is precautionary, not load-bearing.
- **Two `claude/<slug>` branches still exist locally** (`claude/jolly-elgamal-d5ef7f`, `claude/zealous-lumiere-45dbae`) for two of the four sessions, while the other two (`claude/epic-banach-de0c78`, `claude/lucid-williams-b3a2c7`) were already deleted during merge cleanup. Asymmetric — the two un-deleted branches likely have unmerged commits or were never associated with a merged PR. Stage 2 should verify before deletion.

### Other

- The audit was performed entirely through canonical paths (`/c/dev/signal-app/...`) despite the harness setting bash CWD to the OneDrive-nested empty dir for this session. Every `git`, `ls`, and `cat` invocation in this audit explicitly `cd`'d to canonical first. Confirms the OneDrive dir is genuinely cosmetic — operationally it does nothing as long as commands explicitly target canonical paths.
