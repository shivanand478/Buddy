# Buddy

A playful desktop companion for macOS and Windows. You tell it what to do and
when — it stays hidden until that moment, appears in the corner for 10–15
seconds, and disappears again.

| Folder | What it is |
|---|---|
| [`buddy-site/`](buddy-site) | The single-page marketing site |
| [`buddy-tauri/`](buddy-tauri) | The desktop app (Tauri — Rust + plain HTML/CSS/JS) |

## Going live

### 1. Create the repo and push

Create an empty **public** repo named `buddy` at
[github.com/new](https://github.com/new) — no README, no .gitignore, this folder
already has both. It must be public: Pages only serves from private repos on a
paid plan.

```bash
git remote add origin https://github.com/shivanand478/Buddy.git
git branch -M main
git push -u origin main
```

If you'd rather use the CLI, `brew install gh && gh auth login && gh repo create
buddy --public --source=. --remote=origin --push` does the same thing — neither
`gh` nor Homebrew is installed on this machine yet.

### 2. Turn on Pages

In **Settings → Pages**, set **Source** to **GitHub Actions**. The next push to
`main` that touches `buddy-site/` deploys the site; you can also run *Deploy
site* manually from the Actions tab. The URL appears in the workflow summary.

### 3. Cut a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

That builds a universal macOS `.dmg` and the Windows `.msi`/`.exe`, and attaches
them to a **draft** release. Review it, then hit publish.

### 4. Nothing — the buttons wire themselves

The site reads your newest published release from the GitHub API and points each
button at the matching installer, so future releases need no edit here. Until a
release is published the buttons say so rather than 404ing.

To pin a specific build instead, set it in `DOWNLOADS` near the bottom of
[`buddy-site/index.html`](buddy-site/index.html); a pinned URL always wins.

## Before you send the link to anyone

**The macOS builds are unsigned and un-notarized.** They run fine on the machine
that built them, but on anyone else's Mac Gatekeeper refuses them outright —
*"Buddy is damaged and can't be opened"* — which reads as a broken download
rather than a security prompt. Fixing it properly needs an Apple Developer
account ($99/yr); `tauri-action` accepts the signing identity and notarization
credentials as repository secrets once you have them.

Windows is friendlier but not clean: SmartScreen shows an "unrecognized app"
warning until the binary builds reputation or you buy a code-signing
certificate.

**Teams, accounts and sync are not implemented.** They need a server, which
doesn't exist yet. The Team view in the app says so rather than pretending.
