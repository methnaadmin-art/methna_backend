# Methna Admin Panel

Professional admin dashboard for the Methna matchmaking backend. Built with **React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui + Recharts**.

## Pages

| Page | Route | Description |
|------|-------|-------------|
| Login | `/login` | Admin/Moderator JWT auth |
| Dashboard | `/` | Stats cards, charts, user growth |
| Users | `/users` | List, search, filter, status change, delete |
| User Detail | `/users/:id` | Profile, photos, subscription, admin actions |
| Reports | `/reports` | View/resolve/dismiss user reports |
| Photo Moderation | `/photos` | Approve/reject pending photos |
| Analytics | `/analytics` | DAU, conversion, retention, matches over time |
| Trust & Safety | `/trust-safety` | Content flags, suspicious detection, shadow ban |
| Security | `/security` | Email domain blacklist management |

## Setup

```bash
# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Start dev server (proxies /api to localhost:3000)
npm run dev
```

Open `http://localhost:5173` in your browser.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `/api/v1` | Backend API base URL |

## Backend Requirements

The admin panel expects the NestJS backend running with these admin endpoints:

- `POST /api/v1/auth/login` — Returns JWT + user with ADMIN role
- `GET /api/v1/admin/stats` — Dashboard statistics
- `GET /api/v1/admin/users` — Paginated user list
- `GET /api/v1/admin/users/:id` — User detail
- `PATCH /api/v1/admin/users/:id/status` — Update user status
- `DELETE /api/v1/admin/users/:id` — Soft-delete user
- `GET /api/v1/admin/reports` — Paginated reports
- `PATCH /api/v1/admin/reports/:id` — Resolve report
- `GET /api/v1/admin/photos/pending` — Pending photos
- `PATCH /api/v1/admin/photos/:id/moderate` — Approve/reject
- `GET /api/v1/analytics/*` — Analytics endpoints
- `GET /api/v1/trust-safety/admin/flags` — Content flags
- `PATCH /api/v1/trust-safety/admin/flags/:id` — Resolve flag
- `POST /api/v1/trust-safety/admin/shadow-ban/:userId`
- `POST /api/v1/trust-safety/admin/detect-suspicious/:userId`
- `GET /api/v1/security/admin/blacklist` — Email blacklist
- `POST /api/v1/security/admin/blacklist` — Add to blacklist
- `DELETE /api/v1/security/admin/blacklist/:domain`

## Build for Production

```bash
npm run build
```

Output in `dist/` — serve with any static file server or deploy to Vercel/Netlify.

## Tech Stack

- **React 18** — UI library
- **TypeScript** — Type safety
- **Vite 5** — Build tool (fast HMR)
- **TailwindCSS 3** — Utility-first CSS
- **shadcn/ui** — Radix UI primitives + Tailwind
- **Recharts** — Charts (area, bar, pie)
- **Lucide React** — Icons
- **Axios** — HTTP client with JWT interceptors
- **React Router 6** — Client-side routing
