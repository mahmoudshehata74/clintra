<?php

namespace App\Support;

use Closure;
use Illuminate\Console\Events\CommandFinished;
use Illuminate\Console\Events\CommandStarting;

final class PlatformSchemaReset
{
    private const SQL = 'DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS platform_crypto CASCADE;';

    private array $commands = [];

    public function __construct(private readonly Closure $connection) {}

    public function starting(CommandStarting $event): void
    {
        if (! in_array($event->command, ['migrate:fresh', 'db:wipe'], true)) {
            return;
        }
        $db = ($this->connection)($event->input->getParameterOption('--database', null));
        if ($db->getDriverName() !== 'pgsql') {
            return;
        }
        $key = $event->command.':'.spl_object_id($event->input);
        if (isset($this->commands[$key])) {
            $this->commands[$key]->armed = false;
        }
        $state = (object) ['armed' => true];
        $this->commands[$key] = $state;
        // CommandStarting precedes Laravel's confirmation/prohibition checks.
        // Defer until the command actually queries its selected connection.
        $db->beforeExecuting(function () use ($state, $db): void {
            if (! $state->armed) {
                return;
            }
            $state->armed = false; // Also prevents recursive execution for this SQL.
            $db->unprepared(self::SQL);
        });
    }

    public function finished(CommandFinished $event): void
    {
        $key = $event->command.':'.spl_object_id($event->input);
        if (isset($this->commands[$key])) {
            $this->commands[$key]->armed = false;
            unset($this->commands[$key]);
        }
    }
}
