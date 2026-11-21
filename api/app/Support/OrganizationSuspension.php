<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;

final class OrganizationSuspension
{
    public static function response(): JsonResponse
    {
        return response()->json(['error' => 'org_disabled', 'message' => 'حساب العيادة موقوف. كلّم فريق كلينترا.'], 403);
    }
}
