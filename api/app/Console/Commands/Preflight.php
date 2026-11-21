<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class Preflight extends Command
{
    protected $signature = 'clintra:preflight';

    protected $description = 'Read-only production deployment checks';

    private bool $failed = false;

    public function handle(): int
    {
        $this->failed = false;
        $this->check('app connection uses clintra_app', function (): bool {
            return DB::connection('pgsql')->selectOne('SELECT session_user AS name')->name === 'clintra_app'
                && DB::getDefaultConnection() === 'pgsql';
        });

        foreach (['clintra_owner', 'clintra_app', 'clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth'] as $name) {
            $this->check("role {$name} attributes", function () use ($name): bool {
                $role = DB::connection('pgsql')->selectOne(
                    'SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ?', [$name],
                );
                $login = in_array($name, ['clintra_owner', 'clintra_app'], true);

                return $role !== null && (array) $role === [
                    'rolcanlogin' => $login, 'rolsuper' => false, 'rolcreatedb' => false,
                    'rolcreaterole' => false, 'rolreplication' => false, 'rolbypassrls' => ! $login,
                ];
            });
        }
        $this->check('clintra_app has no role memberships', fn (): bool => DB::connection('pgsql')->selectOne(
            "SELECT NOT EXISTS (SELECT 1 FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.member WHERE r.rolname = 'clintra_app') AS ok"
        )->ok);
        foreach (['clintra_rls', 'clintra_provision', 'clintra_mint', 'clintra_register', 'clintra_staff', 'clintra_auth'] as $role) {
            $this->check("clintra_owner membership {$role}", fn (): bool => DB::connection('pgsql')->selectOne(
                "SELECT pg_has_role('clintra_owner', ?, 'MEMBER') AS ok", [$role],
            )->ok);
        }
        $this->check('clintra_fixtures absent', fn (): bool => ! DB::connection('pgsql')->table('pg_roles')->where('rolname', 'clintra_fixtures')->exists());
        $this->check('tenant tables FORCE RLS', function (): bool {
            $tables = DB::connection('pgsql')->select(<<<'SQL'
                SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
                FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                  AND (c.relrowsecurity OR c.relname IN ('organizations', 'users', 'locations', 'memberships', 'device')
                       OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname IN ('org_id', 'organization_id') AND NOT a.attisdropped))
                ORDER BY c.relname
            SQL);

            return $tables !== [] && collect($tables)->every(fn ($table) => $table->relrowsecurity && $table->relforcerowsecurity);
        });
        $this->check('migrations up to date', function (): bool {
            // Migration metadata belongs to the CLI's release connection.
            $files = array_map(fn ($file) => pathinfo($file, PATHINFO_FILENAME), glob(database_path('migrations/*.php')));
            $ran = DB::connection('pgsql_owner')->table('migrations')->pluck('migration')->all();

            return $files !== [] && array_diff($files, $ran) === [] && array_diff($ran, $files) === [];
        });
        $this->check('scheduler configured', function (): bool {
            $events = app(\Illuminate\Console\Scheduling\Schedule::class)->events();

            return config('deployment.scheduler_configured') === true && collect($events)->contains(
                fn ($event) => str_contains($event->command ?? '', 'clintra:enforce-ready-identity') && $event->expression === '* * * * *',
            );
        });
        $this->check('CORS origins configured', function (): bool {
            $origins = array_filter(config('cors.allowed_origins', []), fn ($origin) => ! in_array($origin, ['http://localhost:5173', 'http://127.0.0.1:5173'], true));

            return $origins !== [] && collect($origins)->every(fn ($origin) => $this->httpsOrigin($origin));
        });
        $this->check('identity CORS headers configured', fn (): bool => array_diff(
            ['authorization', 'x-clintra-device-proof', 'x-clintra-person-proof'],
            array_map('strtolower', config('cors.allowed_headers', [])),
        ) === []);
        $this->check('APP_DEBUG false', fn (): bool => config('app.debug') === false);
        $this->check('HTTPS application URL', fn (): bool => $this->httpsOrigin(config('app.url', '')));

        return $this->failed ? self::FAILURE : self::SUCCESS;
    }

    private function httpsOrigin(string $value): bool
    {
        $parts = parse_url($value);

        return $parts !== false && ($parts['scheme'] ?? '') === 'https' && ! empty($parts['host'])
            && ! isset($parts['user']) && ! isset($parts['pass']) && ! isset($parts['query']) && ! isset($parts['fragment'])
            && in_array($parts['path'] ?? '', ['', '/'], true) && ! str_contains($value, '*');
    }

    private function check(string $label, callable $check): void
    {
        try {
            $passed = $check();
        } catch (Throwable) {
            $passed = false;
        }
        $this->line(($passed ? 'PASS ' : 'FAIL ').$label);
        $this->failed = $this->failed || ! $passed;
    }
}
