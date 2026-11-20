<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Carries the acting membership into Postgres for Row-Level Security.
 * SET LOCAL only lives for the current transaction (Decision B — not
 * SET SESSION AUTHORIZATION, which conflicts with connection pooling), so
 * applyMembership() must run inside a transaction that wraps the whole
 * request. See App\Http\Middleware\ApplyMembership and api/docs/rls.md.
 */
class DatabaseSession
{
    public function applyMembership(string $membershipId): void
    {
        // set_config(), not a literal "SET LOCAL app.membership_id = ?":
        // Postgres treats SET as a utility statement and rejects a bound
        // parameter there ("syntax error at or near $1"). set_config() is a
        // regular function call, so it accepts one safely, and its third
        // argument (is_local => true) makes it exactly as transaction-scoped
        // as SET LOCAL — see the CLI brief's own SET_CONFIG example.
        DB::select("SELECT set_config('app.membership_id', ?, true)", [$membershipId]);
    }

    /**
     * Acts as another membership of the same organization for what follows —
     * the person who proved an op or a request
     * (docs/design-identity-permissions.md, 3.6) — with the same
     * transaction-scoped set_config as applyMembership. Every RLS policy,
     * current_membership() and current_org() then evaluate for that person.
     * The caller restores the device's own membership (in a finally) when the
     * person's work is done.
     */
    public function actAs(string $membershipId): void
    {
        $this->applyMembership($membershipId);
    }
}
