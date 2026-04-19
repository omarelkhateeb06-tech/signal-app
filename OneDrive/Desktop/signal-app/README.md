# SIGNAL

Professional Intelligence Platform — a curated daily feed of professional news for AI, Finance, and Semiconductor professionals, with personalized "why it matters to you" insights based on the reader's role.

## Monorepo layout

```
signal-app/
├── frontend/   # Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui
├── backend/    # Express + TypeScript + Drizzle ORM (PostgreSQL) + Redis
└── package.json  # npm workspaces
```

## Prerequisites

- Node.js >= 20
- npm >= 10
- (Later phases) PostgreSQL 15+, Redis 7+

## Setup

```bash
# Install all workspace deps
npm install

# Copy env files
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
```

## Development

Run both servers in parallel from the repo root:

```bash
npm run dev
```

- Frontend → http://localhost:3000
- Backend  → http://localhost:3001 (health: `GET /health`)

Or run individually:

```bash
npm run dev:frontend
npm run dev:backend
```

## Scripts (root)

| Script | Description |
| --- | --- |
| `npm run dev` | Start both dev servers in parallel |
| `npm run build` | Build both workspaces for production |
| `npm run lint` | Lint both workspaces |
| `npm run type-check` | TypeScript type-check both workspaces |

## Project overview

See [CLAUDE.md](./CLAUDE.md) for the authoritative project spec, tech stack, coding standards, and phase plan.
