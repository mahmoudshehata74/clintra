<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation of the batch only (docs/audit-sync.md's "Rows going up"):
 * 1 to 200 rows, each an object. Each row's own fields are checked by
 * DeviceAuditPusher, which refuses a bad row alone (`rejected`) so one stray
 * row never fails the rest of its batch.
 */
class PushDeviceAuditRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, mixed>> */
    public function rules(): array
    {
        return [
            'rows' => ['required', 'array', 'min:1', 'max:200'],
            'rows.*' => ['required', 'array'],
        ];
    }
}
