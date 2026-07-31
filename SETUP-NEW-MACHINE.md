# New-machine setup (Windows + VS Code + Claude Code)

Checklist to rebuild the dev environment on a fresh Windows 11 machine and resume
these projects. Work top-to-bottom. Pairs with `price-update-processor/HANDOFF.md`
(what to do once the repo is cloned).

## 1. Git for Windows

- Download: https://git-scm.com/downloads/win — run it, accept defaults (keep
  "Git from the command line and also from 3rd-party software").
- Verify in a new PowerShell: `git --version`
- Set your commit identity (otherwise the first commit lands as `unknown` and
  needs re-authoring):
  ```powershell
  git config --global user.name "Porter Lawless"
  git config --global user.email "porterlawless@gmail.com"
  ```
- Bundled **Git Credential Manager** handles GitHub sign-in — the first clone/push
  of a private repo pops a browser login (sign into GitHub in your browser first).

## 2. Node.js (runs the Next.js apps)

- Download the **LTS** installer: https://nodejs.org (accept defaults; adds `node`
  + `npm` to PATH). Node 22+ required.
- Reopen PowerShell, verify: `node --version` and `npm --version`

## 3. VS Code

- Download: https://code.visualstudio.com
- On "Additional Tasks", tick **Add to PATH** (lets you run `code .`).

## 4. Claude Code CLI

Native installer (recommended — auto-updates). In PowerShell (NOT as admin):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Close/reopen the terminal, then: `claude --version`

> Alternatives (no auto-update): `winget install Anthropic.ClaudeCode` or
> `npm install -g @anthropic-ai/claude-code` (needs Node 22+).

**If `claude` is "not recognized"** it's a PATH refresh issue (the installer puts
it in `~\.local\bin`):

1. Fully **close and reopen the terminal** (in VS Code, quit VS Code entirely — a
   new terminal tab isn't enough; it snapshots env at launch).
2. Confirm it installed: `Test-Path "$env:USERPROFILE\.local\bin\claude.exe"`
3. If present but still not found, ensure it's on the user PATH:
   ```powershell
   $dir = "$env:USERPROFILE\.local\bin"
   $cur = [Environment]::GetEnvironmentVariable('PATH','User')
   if (($cur -split ';') -notcontains $dir) {
     [Environment]::SetEnvironmentVariable('PATH', "$dir;$cur", 'User')
   }
   ```
   Then open a fresh terminal (or sign out/in) and retry.

## 5. (Optional) Claude Code VS Code extension

CLI-only is fine — you can run `claude` in VS Code's integrated terminal. If you
also want the in-editor panel: Extensions (`Ctrl+Shift+X`) → search **Claude Code**
(publisher **Anthropic**) → Install (needs VS Code 1.94+). It shares your sign-in
with the CLI.

## 6. Sign in (one time)

Run `claude` in a terminal → browser opens → sign in with your Anthropic account
(press `c` to copy the URL if it doesn't open) → "Login successful" → Enter.

## 7. Pull the projects

All active work is merged to `main` (Price Update Processor phases 1–5 included),
so the default checkout is the right branch:

```powershell
cd $env:USERPROFILE\Documents
git clone https://github.com/plawless-prs/it-asset-tracker.git
cd it-asset-tracker
npm install
```

If work moves to a feature branch again, `git checkout <branch>` after cloning
(clones fetch all branches but only check out `main`).

Repeat `git clone` for any other repos.

## 8. Restore secrets + ignored data (git does NOT carry these)

- **`.env.local`** (per project) — Supabase + P21 credentials. Copy it from the old
  machine into the project folder. Key names are listed in
  `price-update-processor/HANDOFF.md`. Next.js reads env at startup, so add it
  before `npm run dev`.
- **Git-ignored data** — e.g. `price-update-processor/samples/GAT2026.txt` (real
  Gates data). Only needed for Phase 5 testing; copy over if wanted.
- **Supabase is cloud + shared** — no migrations to re-run.

## 9. Restore MCP tools / connectors

- **claude.ai connectors** (Gmail, Google Drive, Microsoft 365, Superhuman,
  Google Calendar): automatic — they return when you sign in.
- **Claude-in-Chrome** (browser automation): manual — install Chrome + the
  **Claude for Chrome** extension and connect it.
- **Local MCP servers** added by hand: re-add with `/mcp` or `claude mcp add`;
  auth tokens never transfer.

## 10. Start working

```powershell
npm run dev        # http://localhost:3000
claude             # start Claude Code in the project folder
```
Open the folder with `code .` and run `claude` in the integrated terminal.

---

### Common gotchas

| Symptom | Fix |
|---|---|
| `claude` not recognized after install | Fresh terminal / full VS Code restart; see §4. |
| Extension keeps asking to sign in | Launch VS Code via `code .` so it inherits PATH/env. |
| Claude Code can't run Bash | Install Git for Windows (§1) — it provides Git Bash. |
| Private repo clone asks for password | Let Git Credential Manager's browser popup handle it. |
| `npm run dev` fails on missing env | `.env.local` not copied in — add it, restart the dev server. |
| Flood of permission prompts | Run `/fewer-permission-prompts` in Claude Code. |
