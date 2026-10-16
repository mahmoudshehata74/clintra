# Live two-device sync run

`pnpm --dir web test:live` drives two registered devices of one clinic,
each in its own browser context, against the real API and Postgres — the
path the ordinary e2e suite never takes (it runs on the in-browser
`FakeTransport`). Local only: CI does not run it.

## What it checks

`sync.live.spec.ts`, in order, on one freshly provisioned organization:

1. The first device sets up the clinic in settings (today a working day,
   one service); a booking on A appears on B once; a status set on B
   appears on A.
2. A payment taken on B reaches A; B's invoice numbers carry B's own series
   letter.
3. A goes offline, books three patients and takes a payment, comes back:
   B shows each booking once and the payment once.
4. The API is stopped: A's chip reads "السيرفر مش راد", a reload keeps A's
   new booking; the API is started again and both devices converge.
5. Both devices go offline and book the same slot: the first to reconnect
   keeps it; the other is asked to review, naming its lost booking and
   time, and receives the winner's booking.
6. Both offline change the same visit (A marks it arrived, B cancels it):
   once both reconnect, both show the same status.
7. Adding a staff member offline is refused with "إضافة موظف محتاجة اتصال
   بالإنترنت" and adds no one.

Every wait nudges the sync engine (as returning to the tab does) and polls;
nothing sleeps.

## Running it

Prerequisites: the API's "Fresh local setup" (`api/README.md`) done, with
`clintra_test` migrated:

```
cd api
DB_DATABASE=clintra_test php artisan migrate --database=pgsql_owner
```

Then, from the repository root:

```
pnpm --dir web test:live
```

The run:

- starts the API itself (PHP's built-in server on the Laravel app, what
  `php artisan serve` runs) on `127.0.0.1:8000` with
  `DB_DATABASE=clintra_test` — never the dev database — and stops and
  restarts it for scenario 4. If anything already answers on port 8000 it
  refuses to start: stop that server first.
- starts `pnpm dev` on port 5173 (or reuses one already running); Vite's
  `/api` proxy reaches the API.
- provisions a new organization through `php artisan clintra:provision`,
  answering its prompts on stdin, and mints a fresh activation code per
  device with `clintra:mint-activation-code`. Each run therefore works on
  its own clinic and never shares slots with an earlier run; the rows stay
  in `clintra_test`.

The provisioned names are Latin ("Live Clinic 1234", "Live Owner") on
purpose: on Windows, the console layer reads piped answers in the OEM code
page, which has no Arabic, so an Arabic answer would be stored garbled.
The answers are written one at a time, each only after its prompt shows,
because the hidden PIN prompt reads straight from the inherited stdin.
