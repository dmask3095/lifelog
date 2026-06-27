# LifeLog

A personal life-logging app — tasks, habits, health, groceries, and journaling in one place, installable on your phone like a native app. Built for multiple users, each with their own private, isolated account.

## Features

- **📊 Day** — a daily dashboard: productivity/health/hydration/sleep scores, a task breakdown, time breakdown, and a short generated review of how the day went.
- **✅ Tasks** — priority- and status-tracked tasks with hurdles. Anything left incomplete automatically carries forward into today instead of disappearing at midnight, with an "Nd overdue" badge.
- **🔥 Habits** — daily habit checklist with streaks.
- **💚 Health** — hydration, time-of-day breakdown (wasted/rested/cooking/eating), sleep (log actual bed/wake times, not just a duration), and mood — organized as sub-tabs so only one section is on screen at a time.
- **🛒 Groceries** — a kitchen inventory manager: track what's stocked, what needs eating soon, what's already cooked, organize by storage location, and get auto-generated meal ideas from what's actually in stock.
- **📓 Journal** — write freely against a daily prompt; each save appends a new timestamped note rather than overwriting the last one. A full "All Entries" view shows your complete history with entry count and current writing streak.
- **⚙️ Account** — update your profile, change your password, or delete your account (cascades and removes all of your data).
- **Installable PWA** — add it to your phone's home screen and it opens full-screen, no browser chrome, like any other app.

Every user's data is fully isolated — signing up never exposes another account's tasks, journal, or anything else.

## Tech stack

| | |
|---|---|
| Frontend | React 19, TypeScript, Vite, Axios, `vite-plugin-pwa` |
| Backend | Express 5, TypeScript, JWT auth (httpOnly cookies), bcrypt |
| Database | [Turso](https://turso.tech) (hosted libSQL) via `@libsql/client` — also runs against a plain local SQLite file in dev with zero config |
| Deployment | Vercel (frontend) · Render (backend) · Turso (database) |

## Project structure

```
lifelog-app/
├── backend/    Express API (TypeScript)
│   └── src/
│       ├── database.ts      DB connection + schema/migrations
│       ├── routes/          one file per resource (tasks, habits, journal, ...)
│       ├── middleware/       requireAuth (JWT cookie verification)
│       └── auth-utils.ts     JWT signing + cookie config
├── frontend/   React SPA (TypeScript + Vite)
│   └── src/
│       ├── components/        one component per tab/feature
│       ├── context/           AuthContext (session state)
│       └── api.ts             axios client
└── render.yaml  Render Blueprint for one-click backend deploy
```

## Getting started

**Requirements:** Node 20+.

```bash
git clone https://github.com/dmask3095/lifelog.git
cd lifelog

# Backend
cd backend
npm install
cp .env.example .env   # fill in JWT_SECRET (see below) — everything else has a sane local default
npm run dev            # http://localhost:3001, uses a local lifelog.db file automatically

# Frontend (new terminal)
cd frontend
npm install
cp .env.example .env
npm run dev             # http://localhost:5173
```

Sign up for an account in the UI — the first account created on a fresh database automatically claims any pre-existing unowned data (relevant if you're migrating from an older single-user copy of this app).

### Backend environment variables

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | Yes | Any long random string. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | No | Defaults to `3001` |
| `FRONTEND_ORIGIN` | Production | The deployed frontend's URL, for CORS |
| `COOKIE_SECURE` | Production | Set to `true` once served over HTTPS |
| `COOKIE_SAMESITE` | Production | Set to `none` if frontend and backend are on different domains (required alongside `COOKIE_SECURE=true`) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Production | Leave both unset to use a local SQLite file instead |

### Frontend environment variables

| Variable | Notes |
|---|---|
| `VITE_API_BASE_URL` | The backend's `/api` URL. Defaults to `http://localhost:3001/api` for local dev |

## Deployment

This repo deploys as two independent services plus a database, all on free tiers:

1. **Database** — create a [Turso](https://turso.tech) database (`turso db create`, or `turso db import` to bring in an existing SQLite file), then grab its URL and an auth token.
2. **Backend** — push to GitHub, then on [Render](https://render.com) choose **New > Blueprint** and point it at this repo; it reads `render.yaml` automatically. Fill in `JWT_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `FRONTEND_ORIGIN` (once you know it, see step 3).
3. **Frontend** — on [Vercel](https://vercel.com), import the repo, set **Root Directory** to `frontend`, and set `VITE_API_BASE_URL` to your Render backend URL + `/api`.
4. Go back to Render and set `FRONTEND_ORIGIN` to the real Vercel URL, then redeploy.

## License

Personal project — no license file yet, all rights reserved by the author.
