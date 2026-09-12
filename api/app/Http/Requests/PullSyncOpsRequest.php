<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation only, matching SyncTransport.pullSince's contract
 * (web/src/sync/transport.ts): one opaque cursor in. The cursor is a
 * sync_ledger.seq — a non-negative integer — but "opaque to the client"
 * (docs/sync-plan.md's Q9) means this class only ever validates its
 * *shape*, never assumes anything about what the value means; a cursor
 * that's shaped correctly but doesn't make sense (ahead of the org's own
 * history) is the controller's problem, not this class's, since checking
 * that needs a database read this class deliberately doesn't do.
 */
class PullSyncOpsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, string>> */
    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
