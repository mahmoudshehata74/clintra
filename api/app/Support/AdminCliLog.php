<?php

namespace App\Support;

use Closure;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;
use Throwable;

final class AdminCliLog
{
    /** Record the action atomically; failures are recorded after its rollback. */
    public static function run(string $action, Closure $work, Closure $context): int
    {
        $db = DB::connection('pgsql_owner');
        $actionFailed = false;
        try {
            return $db->transaction(function () use ($action, $work, $context, &$actionFailed) {
                try {
                    $result = $work();
                } catch (Throwable $exception) {
                    $actionFailed = true;
                    throw $exception;
                }
                self::write($action, $result === Command::SUCCESS, $context(), $result === Command::SUCCESS ? null : 'command_refused');

                return $result;
            });
        } catch (Throwable $exception) {
            if ($actionFailed) {
                self::write($action, false, $context(), 'command_failed');
            }
            throw $exception;
        }
    }

    private static function write(string $action, bool $succeeded, array $context, ?string $reason): void
    {
        $hostUser = function_exists('posix_geteuid') && function_exists('posix_getpwuid')
            ? (posix_getpwuid(posix_geteuid())['name'] ?? '')
            : (getenv('USERNAME') ?: getenv('USER') ?: get_current_user());
        $target = $context['target_id'] ?? null;
        DB::connection('pgsql_owner')->selectOne('SELECT platform.admin_log_cli(?::jsonb)', [json_encode([
            // Independent of Str's application UUID stream (also used by provisioning fixtures).
            'log_id' => (string) Uuid::uuid4(),
            'action' => $action,
            'target_id' => is_string($target) && Uuid::isValid($target) ? $target : null,
            'succeeded' => $succeeded,
            'reason' => $reason,
            'detail' => [...$context, 'host_user' => $hostUser],
        ], JSON_THROW_ON_ERROR)]);
    }
}
