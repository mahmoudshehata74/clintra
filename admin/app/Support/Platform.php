<?php

namespace App\Support;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class Platform
{
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
            'session_id' => $session ?? (string) Str::uuid(), 'action' => $action, 'reason' => $reason,
            'log_id' => (string) Str::uuid(), 'target_id' => null,
        ]]);
    }

    private function call(string $function, array $arguments): array
    {
        $signatures = ['admin_whoami' => ['uuid'], 'admin_login' => ['jsonb'], 'admin_logout' => ['uuid'],
            'admin_log_page' => ['uuid', 'jsonb'], 'admin_change_password' => ['jsonb'], 'admin_log_refusal' => ['jsonb']];
        $placeholders = implode(',', array_map(fn ($type) => '?::'.$type, $signatures[$function]));
        $bindings = array_map(fn ($value) => is_array($value) || is_object($value) ? json_encode($value, JSON_THROW_ON_ERROR) : $value, $arguments);
        try {
            return json_decode(DB::selectOne('SELECT platform.'.$function.'('.$placeholders.') AS result', $bindings)->result, true, flags: JSON_THROW_ON_ERROR);
        } catch (QueryException $exception) {
            if ($exception->getCode() === '22023') {
                return ['ok' => false, 'reason' => 'invalid_payload'];
            }
            // QueryException includes bound credentials. Do not attach it as a previous exception.
            throw new \RuntimeException('The panel database is unavailable.');
        }
    }
}
