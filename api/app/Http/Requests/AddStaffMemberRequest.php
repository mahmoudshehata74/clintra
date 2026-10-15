<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation only for POST /api/staff (App\Http\Controllers\StaffController).
 * Phone normalisation happens in the controller, as for device registration;
 * whether the caller may add staff, and whether the locations and
 * practitioners named are the caller's, is add_staff_member(jsonb)'s job
 * — never decided here.
 *
 * Every id is minted on the device, the same rule as every other id in this
 * schema. The PIN arrives already hashed (contract/pin-hash.json): the plain
 * PIN never leaves the device.
 */
class AddStaffMemberRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, string>> */
    public function rules(): array
    {
        return [
            'membership_id' => ['required', 'uuid'],
            'user_id' => ['required', 'uuid'],
            'display_name' => ['required', 'string', 'max:120'],
            'phone' => ['required', 'string'],
            'role' => ['required', 'string', 'in:owner,practitioner,assistant,manager'],
            'location_scope' => ['required', 'string', 'in:all,listed'],
            'practitioner_scope' => ['required', 'string', 'in:all,listed,self'],
            'practitioner_id' => ['present', 'nullable', 'uuid'],
            'pin_hash' => ['required', 'string', 'regex:/^[0-9a-f]{64}$/'],
            'pin_salt' => ['required', 'string', 'regex:/^[0-9a-f]{32}$/'],
            'locations' => ['present', 'array'],
            'locations.*.id' => ['required', 'uuid'],
            'locations.*.location_id' => ['required', 'uuid'],
            'practitioners' => ['present', 'array'],
            'practitioners.*.id' => ['required', 'uuid'],
            'practitioners.*.practitioner_id' => ['required', 'uuid'],
        ];
    }
}
