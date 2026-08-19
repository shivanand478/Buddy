# Buddy's account server

Email sign-in with a six-digit code. One file, no build step, no dependencies,
and **no command line** — every step below happens in a browser.

## What it costs

| Service | Free allowance | Card needed? |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day | No |
| Cloudflare D1 | 5 GB stored, 5M row reads/day | No |
| Brevo (email) | 300 emails/day, forever | No |

A sign-in costs 2 requests and 1 email. 300 emails/day is roughly 300 sign-ins
a day — and a session lasts a year, so people sign in about once.

Brevo is the choice here for one specific reason: it will verify **a single
sender address** (`you@gmail.com`) without owning a domain. Resend and Postmark
both require a domain before they'll send to anyone but you.

## Setup

### 1. An email provider — get a key and a verified sender

Any one of these works. The Worker picks whichever key it finds, so you can
switch later by adding a different secret — no code change, no redeploy.

| Provider | Free tier | Secret name(s) | Sends to anyone without a domain? |
|---|---|---|---|
| **Resend** | 3,000/month | `RESEND_API_KEY` | Only with a verified domain |
| **Brevo** | 300/day | `BREVO_API_KEY` | Yes — verify one sender address |
| **Mailjet** | 200/day | `MAILJET_API_KEY` + `MAILJET_SECRET` | Yes — verify one sender address |
| **SendGrid** | 100/day | `SENDGRID_API_KEY` | Yes — "single sender verification" |
| **Resend** | 100/day | `RESEND_API_KEY` | **No** — without a domain it only emails the account owner |

Resend is the odd one out and the trap to avoid: it is the nicest API of the
four, but on a free account with no domain it silently refuses to deliver to
anybody except you. Fine for a smoke test, useless for real users.

Whichever you choose:

1. Sign up for the free plan.
2. Verify a sender address you control — the provider emails it a confirmation
   link. This is the address `SENDER_EMAIL` must be set to.
3. Generate an API key and copy it. It is usually shown only once.

**Brevo only:** check **Security → Authorized IPs**. If "Blocking unauthorized
IP addresses" is *Activated* for API keys, every call from the Worker is
rejected — Cloudflare sends from a large, shifting pool of edge IPs, so there
is no address you could add. Deactivate it for API keys, then reload the page
to confirm it stuck; the success toast has been seen to lie.

### 2. Cloudflare — database

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **Storage & Databases → D1 → Create database.** Name it `buddy`.
3. Open it, choose the **Console** tab, paste all of `schema.sql`, run it.

### 3. Cloudflare — the worker

1. **Compute (Workers) → Create → Start with Hello World → Deploy.**
   Name it `buddy-api`. The starter code is replaced in the next step.
2. **Edit code**, select everything, paste all of `worker.js`, **Deploy**.
3. **Settings → Bindings → Add → D1 database**
   - Variable name: `DB`  (exactly this — the worker looks for `env.DB`)
   - Database: `buddy`
4. **Settings → Variables and Secrets**, add three. Mark the first as a
   **Secret** so it is never readable again:

   | Name | Type | Value |
   |---|---|---|
   | your provider's key from the table above | Secret | the key from step 1 |
   | `SENDER_EMAIL` | Text | your verified sender address |
   | `APP_NAME` | Text | `Buddy` |
   | `SITE_URL` | Text | where invitees download the app |

5. **Deploy** again so the bindings take effect.

### 4. Check it

Open `https://buddy-api.<your-subdomain>.workers.dev/health` in a browser.
You should see something like:

```json
{"ok":true,"email":"brevo","sender":"you@example.com"}
```

`email` names the provider actually in use. If it is `null`, no key was found
and sign-in will report that honestly rather than pretending to send.

### 5. Point the app at it

In `buddy-tauri/src/api.js`, set the base URL:

```js
export const AUTH_BASE = 'https://buddy-api.<your-subdomain>.workers.dev';
```

Rebuild, and the sign-in screen sends real codes. Nothing else changes — the
app already speaks this protocol.

## The live deployment

| | |
|---|---|
| API | `https://buddy-api.buddyapp.workers.dev` |
| Worker | `buddy-api` |
| D1 database | `buddy` — `4993a9cf-ac51-4a2c-a367-61e322a80067` |
| Email | Resend, sending from `buddy@conviea.com` |
| Domain | `conviea.com`, DNS at Hostinger, verified by Resend |

The schema in this file has been run against that database, so the table
definitions here are known to be accepted by real D1 rather than only by the
test stand-in. The full sign-in loop — code emailed, code verified, session
issued, team created, replay refused — has been exercised against this
deployment.

### Two things that cost time, so they are written down

**Adding a secret does not deploy it.** Saving `RESEND_API_KEY` in the
dashboard showed "Value encrypted" immediately, but the *running* version kept
answering `"email":null` — settings and deployments are separate. Re-uploading
the script with the secret listed as `{ "type": "inherit", "name": "..." }`
picks it up without ever handling the value. `/health` naming the live provider
is what makes this visible at all.

**Brevo blocks unauthorized IPs for API keys by default.** There is no address
you could allowlist for a Worker, so every send fails. Deactivate it under
Security → Authorized IPs, then *reload the page* — the success toast has been
observed to lie while the setting silently reverts.

## The endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /auth/request-code` | `{ email }` | `204` |
| `POST /auth/verify` | `{ email, code }` | `{ token, email, name }` |
| `GET /auth/me` | `Authorization: Bearer <token>` | `{ email, name }` |
| `POST /auth/sign-out` | `Authorization: Bearer <token>` | `204` |
| `POST /auth/profile` | `{ name }` | `{ email, name }` |
| `GET /health` | — | `{ ok: true }` |

Teams — every one of these needs `Authorization: Bearer <token>`:

| Route | Body | Returns |
|---|---|---|
| `GET /team` | — | `{ team, members, invites, memberOf }` |
| `POST /team/invite` | `{ email }` | `{ invited }` |
| `POST /team/remove` | `{ email }` | `204` |
| `POST /team/assign` | `{ email, title, date, time, duration_min, remind_offset_min }` | `{ id }` |
| `GET /sync/inbox` | — | `{ tasks: [...] }` |

Errors are always `{ "error": "a sentence meant for a person" }`, and the app
shows that sentence directly. If you reword an error here, the app says the new
words with no change on its side.

## How it's kept safe

- **Codes and tokens are stored only as SHA-256 hashes.** Someone who reads the
  whole database still cannot sign in as anybody.
- **Codes expire in 10 minutes** and die after **5 wrong guesses**, so guessing
  a six-digit code is not worth attempting.
- **Rate limits**: 5 codes per address per hour, 20 per IP per hour. This is
  also what keeps a stranger from burning your 300 free emails.
- **Signing up and signing in are the same request**, so the server never
  reveals whether an address has an account.
- **A failed send deletes the code**, so a code that never reached an inbox is
  never left live.
- **Codes are generated with `crypto.getRandomValues`** and rejection sampling,
  not `Math.random`, and not with the modulo bias that `% 1000000` alone gives.

## Tests

There is no Node on the machine this was written on, so the tests run in a
browser instead:

```bash
python3 test/harness.py
```

Then open `test/run.html`. It builds a page with the real `worker.js`, an
in-memory stand-in for D1, and a recorder in place of Brevo, then runs 56
assertions: the happy path, code reuse, expiry, wrong-code lockout, both rate
limits, malformed input, CORS preflight, a failing email provider, a server
with no email key configured, and the whole team flow — inviting, joining by
signing in, assigning, one-time delivery, removal, and a stranger being
refused.

What that does **not** test is Cloudflare's own SQL engine — the stand-in
answers the statements the worker issues, so a mistake in the SQL itself would
still show up only on first deploy. Step 4 above is the check for that.

## How teams work

An invitation is **a claim on an email address**, not a link to click. Invite
`them@example.com` and the server remembers it; the next time that address
signs in to Buddy — today, or in three weeks — they join. Nothing to paste, no
token to lose, and an invitation sent to someone who has never heard of Buddy
still works whenever they get round to it. Invitations expire after 30 days.

Assigned work waits in `assignments` until the recipient's copy of Buddy
collects it, which it does at launch and every five minutes. **The server hands
each task over exactly once**, so deleting a task on the receiving end does not
bring it back on the next poll.

You can only assign to someone you share a team with. That is checked on the
server, not in the app.

## What isn't built yet

- **Syncing your own tasks between your own machines.** Accounts exist, but
  tasks still live only on the computer that made them. Only assigned work
  crosses the wire.
- **Team names, more than one team, roles beyond owner/member.** Every account
  gets exactly one team, created the first time it is needed.
