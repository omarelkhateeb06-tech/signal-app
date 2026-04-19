# CLAUDE.md - SIGNAL Project Instructions

This is the master instruction file for Claude Code when working on the SIGNAL project.

---

## PROJECT OVERVIEW

**Name:** SIGNAL
**Type:** Professional Intelligence Platform (web app + email + API)
**Description:** A curated daily feed of professional news for AI, Finance, and Semiconductor professionals. Users get personalized "why it matters to you" insights based on their role.

**Business Model:**
- Free tier: Daily feed + weekly email
- Premium: $8/month (full archive + Q&A + learning paths)
- Enterprise: $5K-50K/month (team collaboration + admin dashboard)
- API: Data intelligence for VCs and corporates

---

## TECH STACK (AUTHORITATIVE)

**DO NOT deviate from this stack unless explicitly told:**

### Frontend
- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui
- **State Management:** Zustand (app state) + TanStack Query (server state)
- **HTTP Client:** axios
- **Forms:** react-hook-form + zod validation
- **Icons:** lucide-react

### Backend
- **Framework:** Express.js
- **Language:** TypeScript (strict mode)
- **Database:** PostgreSQL (Drizzle ORM or Prisma)
- **Cache:** Redis (ioredis)
- **Authentication:** JWT (jsonwebtoken + bcryptjs)
- **Email:** SendGrid (@sendgrid/mail)
- **Validation:** zod
- **Job Queue:** BullMQ (Redis-backed)
- **Cron:** node-cron

### DevOps
- **Version Control:** Git + GitHub
- **Frontend Hosting:** Vercel
- **Backend Hosting:** Railway or Render
- **Database Hosting:** Railway PostgreSQL or Supabase
- **Redis Hosting:** Upstash or Railway Redis

---

## PROJECT STRUCTURE

```
signal-app/
├── frontend/                    # Next.js application
│   ├── src/
│   │   ├── app/                 # App Router pages
│   │   │   ├── (auth)/          # Auth pages (login, signup)
│   │   │   ├── (app)/           # Main app (feed, saved, search)
│   │   │   ├── api/             # Frontend API routes (if needed)
│   │   │   └── layout.tsx       # Root layout
│   │   ├── components/          # Reusable components
│   │   │   ├── ui/              # shadcn/ui components
│   │   │   ├── feed/            # Feed-related components
│   │   │   ├── stories/         # Story components
│   │   │   ├── comments/        # Comment components
│   │   │   └── layout/          # Layout components
│   │   ├── lib/                 # Utilities
│   │   │   ├── api.ts           # API client setup
│   │   │   ├── auth.ts          # Auth helpers
│   │   │   └── utils.ts         # General utilities
│   │   ├── hooks/               # Custom React hooks
│   │   │   ├── useStories.ts
│   │   │   ├── useAuth.ts
│   │   │   └── useComments.ts
│   │   ├── types/               # TypeScript types
│   │   └── store/               # Zustand stores
│   ├── public/
│   ├── package.json
│   └── tsconfig.json
│
├── backend/                     # Express application
│   ├── src/
│   │   ├── routes/              # API routes
│   │   │   ├── auth.ts
│   │   │   ├── stories.ts
│   │   │   ├── users.ts
│   │   │   ├── comments.ts
│   │   │   ├── teams.ts
│   │   │   └── intelligence.ts  # v2 API
│   │   ├── controllers/         # Business logic
│   │   ├── services/            # External services
│   │   │   ├── emailService.ts
│   │   │   ├── authService.ts
│   │   │   └── storyService.ts
│   │   ├── middleware/          # Express middleware
│   │   │   ├── auth.ts
│   │   │   ├── errorHandler.ts
│   │   │   └── rateLimiter.ts
│   │   ├── db/                  # Database
│   │   │   ├── schema.ts        # Drizzle schema
│   │   │   ├── migrations/
│   │   │   └── index.ts         # DB connection
│   │   ├── jobs/                # Background jobs
│   │   │   ├── emailScheduler.ts
│   │   │   └── digestCompiler.ts
│   │   ├── types/               # TypeScript types
│   │   ├── utils/               # Utilities
│   │   └── server.ts            # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── shared/                      # Shared types (optional)
│   └── types.ts
│
├── CLAUDE.md                    # This file
├── README.md
└── .gitignore
```

---

## CODING STANDARDS

### TypeScript Rules

1. **Strict mode always** - `"strict": true` in tsconfig.json
2. **No `any` types** - use `unknown` if truly unknown, then type-guard
3. **Explicit return types** on all functions
4. **Use `interface` for objects, `type` for unions/intersections**
5. **Named exports** preferred over default exports (except for Next.js pages)

Example:
```typescript
// GOOD
export interface User {
  id: string;
  email: string;
}

export async function getUser(id: string): Promise<User | null> {
  // ...
}

// BAD
export default async function(id) {
  // ...
}
```

### React/Next.js Rules

1. **Server Components by default** - only use `'use client'` when needed (state, effects, handlers)
2. **Async Server Components** for data fetching
3. **Loading states** with Suspense + loading.tsx
4. **Error boundaries** with error.tsx
5. **Form state** with react-hook-form + zod

### Backend Rules

1. **Validate ALL inputs** with zod schemas before processing
2. **Return consistent error format**: `{ error: { code, message, details? } }`
3. **Use async/await** (never .then/.catch)
4. **Wrap routes in try/catch** - pass errors to errorHandler middleware
5. **Use transactions** for multi-table writes

Example:
```typescript
import { z } from 'zod';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

export async function createUser(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createUserSchema.parse(req.body);
    const user = await authService.createUser(data);
    res.json({ user, token: generateToken(user) });
  } catch (error) {
    next(error);
  }
}
```

### Database Rules

1. **Always use migrations** - never alter tables directly
2. **UUIDs for primary keys** - not auto-increment integers
3. **Timestamps on everything** - created_at, updated_at
4. **Indexes on foreign keys** and common query fields
5. **Soft deletes** where appropriate (deleted_at TIMESTAMP)

### Security Rules

1. **NEVER log passwords, tokens, or API keys**
2. **Hash passwords** with bcryptjs (cost 12)
3. **Validate JWT tokens** on every protected endpoint
4. **Rate limit** by IP and user
5. **SQL injection prevention** - use parameterized queries (ORM handles this)
6. **XSS prevention** - sanitize user input on display
7. **CORS** - explicit allowed origins

### Testing Rules

1. **Unit tests** for utility functions and services
2. **Integration tests** for API endpoints
3. **Run tests before committing** - `npm test`
4. **Coverage target: 70%+** for critical paths

---

## DATABASE SCHEMA

See detailed schema at `docs/SCHEMA.md`. Key tables:

- `users` - User accounts
- `user_profiles` - Sectors, role, preferences
- `stories` - Content/digest stories
- `user_saves` - Saved stories
- `comments` - Threaded comments
- `teams` - Enterprise teams
- `team_members` - Team membership
- `learning_paths` - Learning path metadata
- `learning_path_stories` - Path-story relationships
- `user_learning_progress` - User progress tracking
- `writers` - Content writers
- `email_queue` - Email sending queue
- `api_keys` - API authentication keys

---

## API DESIGN PRINCIPLES

1. **RESTful conventions** - GET, POST, PUT, PATCH, DELETE
2. **Versioned URLs** - `/api/v1/` and `/api/v2/`
3. **Consistent response format**:
   ```json
   {
     "data": { ... },     // on success
     "error": {           // on error
       "code": "INVALID_INPUT",
       "message": "...",
       "details": { ... }
     }
   }
   ```
4. **Pagination** for list endpoints - `?limit=20&offset=0`
5. **Filtering** via query params - `?sector=ai&status=published`

---

## ENVIRONMENT VARIABLES

Create `.env.example` files. Variables needed:

### Frontend (.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Backend (.env)
```
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/signal
REDIS_URL=redis://localhost:6379
JWT_SECRET=<generate-random-64-char-string>
JWT_EXPIRES_IN=7d
SENDGRID_API_KEY=<from-sendgrid>
SENDER_EMAIL=noreply@signal.so
FRONTEND_URL=http://localhost:3000
```

---

## BUILD PHASES

Work through phases sequentially. Do NOT skip ahead.

**Phase 0:** Project setup (GitHub, repos, tooling)
**Phase 1:** Database setup + migrations
**Phase 2:** Authentication (signup, login, JWT)
**Phase 3:** User profiles + onboarding
**Phase 4:** Stories & feed (core experience)
**Phase 5:** Saves & comments
**Phase 6:** Search
**Phase 7:** Email system (weekly digests)
**Phase 8:** Deployment setup
**Phase 9:** Teams/Enterprise features
**Phase 10:** Learning paths & credentials
**Phase 11:** API v2 (intelligence endpoints)

**See `docs/PHASES/` for detailed phase instructions.**

---

## IMPORTANT RULES FOR CLAUDE CODE

1. **ALWAYS read this file first** before starting work
2. **ASK FOR CLARIFICATION** if requirements are ambiguous
3. **WRITE TESTS** for new features
4. **UPDATE DOCS** when changing behavior
5. **COMMIT OFTEN** - small, focused commits with clear messages
6. **RUN LINTING** before committing - `npm run lint`
7. **RUN TYPE CHECK** before committing - `npm run type-check`
8. **DON'T INSTALL PACKAGES** without justification
9. **DON'T CREATE FILES** outside the project structure
10. **DON'T MODIFY** package.json dependencies without asking

---

## COMMON TASKS

### Adding a new API endpoint
1. Define zod schema in route file
2. Create controller function
3. Add route with middleware
4. Write integration test
5. Update API docs

### Adding a new page
1. Create page in `app/` directory
2. Create associated components in `components/`
3. Add loading.tsx and error.tsx
4. Update navigation if needed

### Adding a new database table
1. Add to schema.ts
2. Generate migration
3. Run migration
4. Add TypeScript types
5. Add service functions

---

## RESOURCES

- Technical specification: `docs/SPEC.md`
- Database schema: `docs/SCHEMA.md`
- API documentation: `docs/API.md`
- Phase instructions: `docs/PHASES/`
- Deployment guide: `docs/DEPLOYMENT.md`

---

## SUCCESS CRITERIA

A phase is complete when:
- [ ] All features work end-to-end
- [ ] Tests pass
- [ ] Linting passes
- [ ] Type checking passes
- [ ] Code reviewed (self-review minimum)
- [ ] Documentation updated
- [ ] Deployed and verified

---

**When in doubt, ask. When uncertain, test. When done, commit.**
