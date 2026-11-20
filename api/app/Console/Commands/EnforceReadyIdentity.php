<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class EnforceReadyIdentity extends Command
{
    protected $signature = 'clintra:enforce-ready-identity';

    protected $description = 'Enable account enforcement for organizations past the first-owner-password grace period that are ready';

    public function handle(): int
    {
        $connection = DB::connection('pgsql_owner');
        $call = static function (array $payload) use ($connection): array {
            $row = $connection->selectOne('select auth_identity_rollout(?::jsonb) as result', [json_encode($payload, JSON_THROW_ON_ERROR)]);

            return json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);
        };

        foreach ($call(['action' => 'candidates'])['organizations'] as $orgId) {
            $call(['action' => 'automatic', 'org_id' => $orgId]);
        }

        return self::SUCCESS;
    }
}
