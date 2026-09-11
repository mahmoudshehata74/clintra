<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * Shape validation only — phone normalization (App\Support\EgyptianPhone)
 * and activation-code hashing/verification happen in the controller, since
 * those can fail for reasons that are either "bad payload" (422, not a
 * valid phone at all) or "wrong credential" (401, deliberately generic —
 * see register_device(jsonb)'s own doc comment), and this class only
 * knows about the former.
 */
class RegisterDeviceRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, array<int, string>> */
    public function rules(): array
    {
        return [
            'phone' => ['required', 'string'],
            'activation_code' => [
                'required',
                'string',
                'regex:/^CLT-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){3}$/',
            ],
            'device_id' => ['required', 'uuid'],
        ];
    }
}
