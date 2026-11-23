<?php

namespace App\Support;

use DateTimeImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Platform
{
    private const SIGNATURES = [
        'admin_whoami' => ['uuid'], 'admin_login' => ['jsonb'], 'admin_logout' => ['uuid'],
        'admin_log_page' => ['uuid', 'jsonb'], 'admin_change_password' => ['jsonb'], 'admin_log_refusal' => ['jsonb'],
        'admin_org_figures' => ['uuid', 'date', 'date', 'uuid'], 'admin_org_detail' => ['uuid', 'uuid'],
        'admin_org_names' => ['uuid', 'uuid[]'], 'admin_org_list' => ['uuid'],
        'admin_set_org_disabled' => ['uuid', 'text', 'uuid', 'boolean', 'text', 'uuid'],
    ];

    public function whoami(?string $session): array
    {
        return $this->call('admin_whoami', [$session]);
    }

    public function login(array $payload): array
    {
        return $this->call('admin_login', [$payload]);
    }

    public function logout(string $session): array
    {
        return $this->call('admin_logout', [$session]);
    }

    public function logs(string $session, array $filters): array
    {
        return $this->call('admin_log_page', [$session, (object) $filters]);
    }

    public function changePassword(array $payload): array
    {
        return $this->call('admin_change_password', [$payload]);
    }

    public function refusal(?string $session, string $action, string $reason): array
    {
        return $this->call('admin_log_refusal', [[
            'session_id' => $session ?? (string) Str::uuid(), 'action' => $action,
            'reason' => $reason, 'log_id' => (string) Str::uuid(), 'target_id' => null,
        ]]);
    }

    public function orgList(string $session): array
    {
        return $this->call('admin_org_list', [$session]);
    }

    public function orgNames(string $session, array $ids): array
    {
        // IDs originate in the locked result of admin_log_page; the array is bound, never SQL text.
        return $this->call('admin_org_names', [$session, '{'.implode(',', $ids).'}']);
    }

    public function orgDetail(string $session, string $org): array
    {
        return $this->call('admin_org_detail', [$session, $org]);
    }

    public function setOrgDisabled(string $session, mixed $otp, string $org, mixed $disabled, mixed $reason): array
    {
        return $this->call('admin_set_org_disabled', [$session, is_string($otp) ? $otp : null, $org,
            match ($disabled) { '1' => 'true', '0' => 'false', default => null },
            is_string($reason) ? $reason : null, (string) Str::uuid()]);
    }

    public function figures(string $session, mixed $from = null, mixed $to = null): array
    {
        $dates = array_map(self::databaseDate(...), [$from, $to]);
        // A non-finite date reaches the function's logged refusal path; a malformed cast would not.
        $rows = $this->call('admin_org_figures', [$session, ...$dates, (string) Str::uuid()]);
        $identity = null;
        if ($rows === []) {
            $identity = $this->whoami($session);
            if (! $identity['ok']) {
                return $identity;
            }
            if ($identity['must_change_password']) {
                return ['ok' => false, 'reason' => 'password_change_required'];
            }
        }
        if (in_array('infinity', $dates, true)) {
            return ['ok' => false, 'reason' => 'invalid_payload'];
        }
        $end = new DateTimeImmutable($dates[1] ?? date('Y-m-d'));
        $start = $dates[0] === null ? $end->modify('-29 days') : new DateTimeImmutable($dates[0]);
        if ($start > $end || $start->diff($end)->days > 365) {
            return ['ok' => false, 'reason' => 'invalid_payload'];
        }

        return ['ok' => true, 'rows' => $rows];
    }

    private static function databaseDate(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_string($value) || ! preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D', $value) || str_starts_with($value, '0000-')) {
            return 'infinity';
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);

        return $date && $date->format('Y-m-d') === $value ? $value : 'infinity';
    }

    private function call(string $function, array $arguments): array
    {
        $casts = implode(',', array_map(fn ($type) => '?::'.$type, self::SIGNATURES[$function]));
        $bindings = array_map(fn ($value) => is_array($value) || is_object($value) ? json_encode($value, JSON_THROW_ON_ERROR) : $value, $arguments);
        $sql = $function === 'admin_org_figures'
            ? "SELECT coalesce(jsonb_agg(f),'[]'::jsonb) AS result FROM platform.admin_org_figures($casts) f"
            : 'SELECT platform.'.$function.'('.$casts.') AS result';
        try {
            return json_decode(DB::selectOne($sql, $bindings)->result, true, flags: JSON_THROW_ON_ERROR);
        } catch (QueryException $exception) {
            if ($exception->getCode() === '22023') {
                return ['ok' => false, 'reason' => 'invalid_payload'];
            }
            // Bound credentials must not be included in an exception chain or application log.
            throw new \RuntimeException('The panel database is unavailable.');
        }
    }
}
