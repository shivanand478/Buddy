# Buddy — desktop app (Tauri)

A playful companion for macOS and Windows. You tell it what to do and when; it
stays hidden until that moment, appears in the corner for 10–15 seconds, and
disappears again.

## Build & run

```bash
cd src-tauri && cargo tauri dev     # run it
cargo tauri build                   # bundle .app / .dmg / .msi / .nsis
```

Needs only the Rust toolchain — the front end is plain HTML/CSS/JS with no
bundler, so there's no Node or npm anywhere in the build.

Cross-compiling isn't a thing here: the Windows installers must be built on
Windows (or in CI on a Windows runner). Same source, same commands.

## Layout

| Path | What's in it |
|---|---|
| `src-tauri/src/model.rs` | Tasks, routine, water, goals, prefs, and the time helpers |
| `src-tauri/src/scheduler.rs` | What's due right now, day rollover, weekly check-in |
| `src-tauri/src/store.rs` | Atomic JSON persistence |
| `src-tauri/src/lib.rs` | Tray, windows, commands, the 15-second tick |
| `src/index.html` · `app.js` | Main window: Today, Tasks, Routine, Team, Goals, Settings |
| `src/reminder.html` · `reminder.js` | The corner popup |
| `src/onboarding.html` · `onboarding.js` | The seven-screen first run |
| `src/characters.js` | The five buddies as one SVG sprite |
| `tools/make_icon.py` | Renders the app icon from scratch (stdlib only) |
| `tools/inline_preview.py` | Flattens a window into one self-contained HTML file for visual review in a plain browser |

## Decisions worth knowing

**Time is the primary key.** Every task carries a date and a `HH:MM`, and the
reminder fires at that moment minus the user's chosen offset (0 / 15 / 30 min).
Nothing polls "what's important now" — the clock decides.

**One popup, never a stack.** The tick collects *everything* due in that moment
and hands it over as a single list. Three things at 5:30 render as one grouped
reminder with a Done button per line, rather than three windows fighting for the
same corner.

**A missed moment expires.** A reminder is only shown within 15 minutes of its
time. After that the moment has passed and nagging about it is just noise — it
stays open on the list instead.

**Hovering pauses the countdown**, so the popup can't vanish out from under a
cursor on its way to Done. Leaving restarts a shorter 4-second timer.

**The reminder window never takes focus** — it's built with `focused(false)`,
always-on-top, and skips the taskbar, so it can't interrupt typing.

## In this build

Time-based reminders with offsets · Done / Snooze / Skip · auto-dismiss with a
countdown ring · collision grouping · tasks with repeat rules · routine with
per-weekday scheduling · optional water reminder · goals with a daily action ·
quiet hours · character selection · Today / Tasks / Routine / Team / Goals /
Settings · tray with no Dock icon · launch at login · native notifications
alongside the popup · local JSON storage · seven-screen onboarding.

## Not in this build

**Accounts, sync, and real teams.** §46–47 need a server: an identity to log in
as, and somewhere for an assigned task to travel between two people's machines.
The Team view says so plainly rather than faking it, and lets you create a task
with an `assigned by` name so you can see how a team reminder looks and behaves.
Everything else on the team side — invites, member lists, cross-device sync — is
waiting on that backend.

**Windows binaries.** The code is cross-platform and the config already declares
`msi` and `nsis` targets, but they've only been compiled and run on macOS here.
Windows needs a build on a Windows machine before it can be called done.
