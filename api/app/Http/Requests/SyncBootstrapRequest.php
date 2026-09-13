<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation only, matching PullSyncOpsRequest's own discipline: this
 * class only ever checks that the cursor *looks like* one of
 * SyncBootstrapPuller's own opaque cursors ("{stage 0-3}:{uuid or empty}"),
 * never what it means — a well-shaped but nonsensical cursor is the
 * controller/puller's problem, not this class's.
 */
class SyncBootstrapRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, string>> */
    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'string', 'regex:/^[0-3]:[0-9a-fA-F-]*$/'],
        ];
    }
}
