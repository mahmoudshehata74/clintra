<?php

namespace App\Support;

final class Figures
{
    public const COLUMNS = [
        'active_locations' => 'الفروع', 'active_practitioners' => 'الدكاترة', 'active_members' => 'الموظفين',
        'active_devices' => 'الأجهزة', 'last_sync_at' => 'آخر مزامنة', 'visits_completed' => 'زيارات اكتملت',
        'visits_cancelled' => 'اتلغت', 'visits_no_show' => 'ماحضرش', 'invoices_issued' => 'فواتير',
        'billed_piastres' => 'المطلوب', 'collected_piastres' => 'المتحصّل',
    ];

    public static function value(string $column, mixed $value): string
    {
        if ($column === 'last_sync_at') {
            return $value === null ? '—' : (new \DateTimeImmutable($value))->setTimezone(new \DateTimeZone('Africa/Cairo'))->format('Y-m-d H:i:s');
        }
        if (str_ends_with($column, '_piastres')) {
            // Keep bigint precision: no floating point conversion on the way to pounds.
            $digits = str_pad(ltrim((string) $value, '-'), 3, '0', STR_PAD_LEFT);

            return (str_starts_with((string) $value, '-') ? '-' : '').substr($digits, 0, -2).'.'.substr($digits, -2);
        }

        return (string) $value;
    }
}
