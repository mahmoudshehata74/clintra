# Clintra

Clinic operating system for Egypt. Arabic (RTL), offline-first.

## Layout
- `web/`      - frontend (React + Vite + TypeScript, PWA)
- `api/`      - backend (Laravel)
- `contract/` - API contract shared by every client
- `docs/`     - internal documentation
- `e2e/`      - end-to-end tests

## Development
Requires Node.js 22+ and pnpm (version pinned in `web/package.json`).

```
pnpm --dir web install
pnpm --dir web dev
```

## Backend
Laravel 13 on PHP 8.3+, PostgreSQL, Sanctum for device tokens. See
`api/README.md` for setup.

## Deployment
Pushes to `main` deploy automatically via Vercel.
