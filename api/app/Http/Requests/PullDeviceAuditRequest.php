<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * device_audit_log.seq as an opaque cursor, as PullSyncOpsRequest's: absent
 * on a device's first pull (DeviceAuditPuller::firstPullStart), a
 * non-negative integer afterwards.
 */
class PullDeviceAuditRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, mixed>> */
    public function rules(): array
    {
        return [
            'cursor' => ['nullable', 'integer', 'min:0'],
        ];
    }
}
