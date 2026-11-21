<?php

namespace App\Console\Commands;

use App\Support\ActivationCode;
use App\Support\AdminCliLog;
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
 *
 * --purpose=owner-recovery (identity A1, docs/design-identity-permissions.md
 * 3.7 and "A1 decisions", 5) mints the code the owner uses with their phone
 * to set a new password (POST /api/auth/owner-recovery) instead: single use,
 * valid 24 hours, never accepted by device registration. The location
 * argument stays required for both. Either code is printed once, here, and
 * never logged: only its SHA-256 is stored.
 */
class MintActivationCode extends Command
{
    /** How long an owner-recovery code lives. */
    public const OWNER_RECOVERY_LIFETIME_HOURS = 24;

    protected $signature = 'clintra:mint-activation-code
        {org_id : The organization to mint a code for}
        {location_id : The location the new device will serve}
        {--purpose=device : device (register a device) or owner-recovery (set a new owner password)}';

    protected $description = 'Mints a new one-time activation code for an existing organization, for registering a replacement device or recovering the owner\'s password';

    public function handle(): int
    {
        return AdminCliLog::run('cli.mint', fn () => $this->mint(), fn () => [
            'org_id' => $this->argument('org_id'), 'target_id' => $this->argument('location_id'),
            'purpose' => $this->option('purpose'),
        ]);
    }

    private function mint(): int
    {
        $orgId = $this->argument('org_id');
        $locationId = $this->argument('location_id');
        $purpose = $this->option('purpose');

        if (! in_array($purpose, ['device', 'owner-recovery'], true)) {
            $this->error('--purpose must be device or owner-recovery.');

            return self::INVALID;
        }

        $ownerRecovery = $purpose === 'owner-recovery';
        $lifetimeHours = $ownerRecovery ? self::OWNER_RECOVERY_LIFETIME_HOURS : ActivationCode::LIFETIME_HOURS;
        $code = ActivationCode::generate();

        $payload = [
            'id' => (string) Str::uuid(),
            'org_id' => $orgId,
            'location_id' => $locationId,
            'code_hash' => ActivationCode::hash($code),
            'expires_at' => now()->addHours($lifetimeHours)->toIso8601String(),
            'audit_id' => (string) Str::uuid(),
        ];

        // A device code's payload is exactly what it was before purposes
        // existed (mint_activation_code reads an absent purpose as device).
        if ($ownerRecovery) {
            $payload['purpose'] = 'owner_recovery';
        }

        $row = DB::connection('pgsql_owner')->selectOne(
            'select mint_activation_code(?::jsonb) as result',
            [json_encode($payload, JSON_THROW_ON_ERROR)],
        );
        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);

        $this->newLine();
        if ($ownerRecovery) {
            $this->info("Owner-recovery code minted for org {$result['org_id']}.");
            $this->warn('OWNER-RECOVERY CODE — shown once, give it to the owner only after confirming them by phone:');
        } else {
            $this->info("Activation code minted for org {$result['org_id']}, location {$result['location_id']}.");
            $this->warn('ACTIVATION CODE — shown once, write it down now:');
        }
        $this->line("    {$code}");
        $this->warn('Expires in '.$lifetimeHours.' hours.');

        return self::SUCCESS;
    }
}
