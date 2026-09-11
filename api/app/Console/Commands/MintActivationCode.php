<?php

namespace App\Console\Commands;

use App\Support\ActivationCode;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Mints a fresh activation code for an org that already exists — devices
 * get replaced over a clinic's lifetime, so `clintra:provision`'s one code
 * (shown once, at first setup) can't be the only way to get one. Calls
 * mint_activation_code(jsonb), the same CLI-only, provisioning-function
 * path as everything else that creates an org-scoped secret (never
 * through clintra_app — see api/docs/rls.md).
 */
class MintActivationCode extends Command
{
    protected $signature = 'clintra:mint-activation-code {org_id : The organization to mint a code for} {location_id : The location the new device will serve}';

    protected $description = 'Mints a new one-time activation code for an existing organization, for registering a replacement device';

    public function handle(): int
    {
        $orgId = $this->argument('org_id');
        $locationId = $this->argument('location_id');

        $code = ActivationCode::generate();

        $payload = [
            'id' => (string) Str::uuid(),
            'org_id' => $orgId,
            'location_id' => $locationId,
            'code_hash' => ActivationCode::hash($code),
            'expires_at' => now()->addHours(ActivationCode::LIFETIME_HOURS)->toIso8601String(),
            'audit_id' => (string) Str::uuid(),
        ];

        $row = DB::connection('pgsql_owner')->selectOne(
            'select mint_activation_code(?::jsonb) as result',
            [json_encode($payload, JSON_THROW_ON_ERROR)],
        );
        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);

        $this->newLine();
        $this->info("Activation code minted for org {$result['org_id']}, location {$result['location_id']}.");
        $this->warn('ACTIVATION CODE — shown once, write it down now:');
        $this->line("    {$code}");
        $this->warn('Expires in '.ActivationCode::LIFETIME_HOURS.' hours.');

        return self::SUCCESS;
    }
}
