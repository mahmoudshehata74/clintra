# Clintra

Clinic operating system for Egypt. Arabic (RTL), offline-first.

## Layout
- `web/`      - frontend (React + Vite + TypeScript, PWA)
- `api/`      - backend (Laravel), added later
- `contract/` - API contract shared by every client
- `docs/`     - internal documentation
- `e2e/`      - end-to-end tests

## Development
Requires Node.js 22+ and pnpm (version pinned in `web/package.json`).

```
pnpm --dir web install
pnpm --dir web dev
```

## Deployment
Pushes to `main` deploy automatically via Vercel.
