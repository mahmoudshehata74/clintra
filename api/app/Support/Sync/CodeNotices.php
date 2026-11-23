<?php

namespace App\Support\Sync;

use Illuminate\Support\Facades\DB;

/** Reads only the requesting clinic's notices through its normal RLS session. */
final class CodeNotices
{
    public static function current(): array
    {
        return DB::table('admin_code_notices')
            ->where('issued_at', '>', now()->subDays(7))
            ->orderByDesc('issued_at')
            ->get(['id', 'purpose', 'issued_at'])
            ->map(fn ($row) => (array) $row)->all();
    }
}
