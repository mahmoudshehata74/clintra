# Clintra API

Laravel backend for Clintra. Standalone JSON API — the web app (and later
Android) are clients of these endpoints, never the source of truth.

## Requirements
- PHP 8.3+
- Composer 2.7+
- PostgreSQL (schema and RLS policies are set up in a later task)

## Setup

```
cd api
composer install
cp .env.example .env
php artisan key:generate
php artisan serve
```

The server listens on `http://localhost:8000` by default. Health check:

```
curl http://localhost:8000/api/health
```

## Conventions
- IDs are UUID v4, always generated on the client — Laravel never generates
  its own (`config('app.client_generated_ids')`).
- Money is integer piastres, never floats.
- Timezone is `Africa/Cairo`; locale is `ar` with `en` fallback.
- Auth is Sanctum device tokens, not sessions.
- Every response is JSON — there are no HTML error pages.

## Tests

```
php artisan test
```
