<?php

namespace App\Http\Requests;

use App\Support\Sync\SyncableTables;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation only, matching SyncTransport.pushOps's contract
 * (web/src/sync/transport.ts): an array of ops, each carrying op_id,
 * entity, entity_id, action, payload, created_at, and base_rev (required
 * for update/delete — docs/sync-plan.md's Q5 edit-conflict mechanism —
 * and absent for create, since "an insert carries no base_rev").
 * Anything that fails here is a malformed batch (422), never mistaken for
 * a business conflict or a credential problem.
 */
class PushSyncOpsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, mixed>> */
    public function rules(): array
    {
        return [
            'ops' => ['required', 'array', 'min:1'],
            'ops.*.op_id' => ['required', 'uuid'],
            'ops.*.entity' => ['required', 'string', 'in:'.implode(',', SyncableTables::NAMES)],
            'ops.*.entity_id' => ['required', 'uuid'],
            'ops.*.action' => ['required', 'string', 'in:create,update,delete'],
            'ops.*.payload' => ['required_unless:ops.*.action,delete', 'nullable', 'array'],
            'ops.*.created_at' => ['required', 'date'],
            'ops.*.base_rev' => ['prohibited_if:ops.*.action,create', 'required_if:ops.*.action,update,delete', 'integer', 'min:1'],
        ];
    }
}
