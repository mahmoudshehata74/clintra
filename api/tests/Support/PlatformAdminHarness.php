<?php

namespace Tests\Support;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

trait PlatformAdminHarness
{
    private array $platformAdminIds = [];

    protected function panel(): Connection
    {
        if (! config('database.connections.platform_panel')) {
            $config = config('database.connections.pgsql_owner');
            $config['url'] = null;
            $config['username'] = 'clintra_admin_app';
            $config['password'] = env('DB_ADMIN_APP_PASSWORD');
            $config['search_path'] = 'platform';
            if (! is_string($config['password']) || $config['password'] === '') {
                throw new \RuntimeException('The ignored test environment must provide DB_ADMIN_APP_PASSWORD');
            }
            config(['database.connections.platform_panel' => $config]);
        }

        return DB::connection('platform_panel');
    }

    protected function platformId(): string
    {
        return (string) Uuid::uuid4();
    }

    protected function platformIp(): string
    {
        // Logs are immutable and survive targeted test runs; addresses must
        // also be unique across separate invocations of the suite.
        return '2001:db8:'.implode(':', str_split(substr(str_replace('-', '', $this->platformId()), 0, 24), 4));
    }

    protected function platformAdmin(array $overrides = []): array
    {
        $admin = ['id' => $this->platformId(), 'email' => 'b1-'.$this->platformId().'@example.invalid',
            'password' => 'Correct-admin-password-123', 'secret' => '12345678901234567890'];
        $this->asOwner()->insert(<<<'SQL'
            INSERT INTO platform.admin_users(id,email,name,password_hash,totp_secret,must_change_password)
            VALUES (?::uuid,?,'Test admin',platform_crypto.crypt(?,platform_crypto.gen_salt('bf',12)),decode(?,'hex'),false)
        SQL, [$admin['id'], $admin['email'], $admin['password'], bin2hex($admin['secret'])]);
        if ($overrides !== []) {
            $this->asOwner()->table('platform.admin_users')->where('id', $admin['id'])->update($overrides);
        }
        $this->platformAdminIds[] = $admin['id'];

        return $admin;
    }

    protected function trackPlatformAdmin(string $id): void
    {
        $this->platformAdminIds[] = $id;
    }

    protected function platformStep(): int
    {
        return (int) $this->asOwner()->selectOne('SELECT floor(extract(epoch FROM now())/30) AS step')->step;
    }

    /** Independent RFC 4226/6238 implementation; never calls the function under test. */
    protected function platformOtp(string $secret, ?int $step = null): string
    {
        $step ??= $this->platformStep();
        $mac = hash_hmac('sha1', pack('N2', intdiv($step, 4294967296), $step & 0xFFFFFFFF), $secret, true);
        $offset = ord($mac[19]) & 15;
        $value = unpack('N', substr($mac, $offset, 4))[1] & 0x7FFFFFFF;

        return sprintf('%06d', $value % 1000000);
    }

    protected function platformLoginPayload(array $admin, array $overrides = []): array
    {
        return array_replace(['email' => $admin['email'], 'password' => $admin['password'],
            'otp' => $this->platformOtp($admin['secret']), 'ip' => $this->platformIp(), 'user_agent' => 'B1 tests',
            'session_id' => $this->platformId(), 'log_id' => $this->platformId()], $overrides);
    }

    protected function platformCall(string $function, array $payload): array
    {
        $allowed = ['admin_login', 'admin_change_password', 'admin_log_refusal'];
        if (! in_array($function, $allowed, true)) {
            throw new \RuntimeException('Unexpected panel function');
        }
        $row = $this->panel()->selectOne('SELECT platform.'.$function.'(?::jsonb) AS result', [json_encode($payload, JSON_THROW_ON_ERROR)]);

        return json_decode($row->result, true, flags: JSON_THROW_ON_ERROR);
    }

    protected function platformSession(array $admin, array $overrides = []): string
    {
        $id = $this->platformId();
        $this->asOwner()->insert("INSERT INTO platform.admin_sessions(id,admin_user_id,expires_at) VALUES (?::uuid,?::uuid,now()+interval '8 hours')", [$id, $admin['id']]);
        if ($overrides !== []) {
            $this->asOwner()->table('platform.admin_sessions')->where('id', $id)->update($overrides);
        }

        return $id;
    }

    protected function asPlatformRole(string $role, \Closure $work): mixed
    {
        if (! preg_match('/^clintra_[a-z_]+$/', $role)) {
            throw new \RuntimeException('Unexpected test role');
        }

        return $this->asOwner()->transaction(function ($db) use ($role, $work) {
            $db->statement('SET LOCAL ROLE '.$role);
            try {
                return $work($db);
            } finally {
                $db->statement('RESET ROLE');
            }
        });
    }

    protected function endPlatformFixtures(): void
    {
        try {
            if ($this->platformAdminIds !== []) {
                $this->asOwner()->table('platform.admin_users')->whereIn('id', $this->platformAdminIds)->update(['is_active' => false]);
                $this->asOwner()->table('platform.admin_sessions')->whereIn('admin_user_id', $this->platformAdminIds)
                    ->update(['ended_at' => now()->toIso8601String()]);
            }
        } finally {
            DB::purge('platform_panel');
            DB::disconnect('pgsql_owner');
        }
    }
}
