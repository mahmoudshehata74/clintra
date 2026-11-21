<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SetOrganizationDisabled extends Command
{
    protected $signature = 'clintra:organization-status {org_id} {status : enabled or disabled} {--reason= : Required when disabling}';

    protected $description = 'Enable or suspend an organization, retaining its data and device tokens';

    public function handle(): int
    {
        $orgId = $this->argument('org_id');
        $status = $this->argument('status');
        $reason = trim((string) $this->option('reason'));
        if (! Str::isUuid($orgId) || ! in_array($status, ['enabled', 'disabled'], true)
            || ($status === 'disabled' && ($reason === '' || mb_strlen($reason) > 200))) {
            $this->error('Provide an organization UUID, enabled or disabled, and a reason of 1 to 200 characters when disabling.');

            return self::INVALID;
        }
        $db = DB::connection('pgsql_owner');
        $db->statement('SET ROLE clintra_rls');
        try {
            $owner = $db->selectOne("SELECT id FROM memberships WHERE org_id = ? AND role = 'owner' AND is_active ORDER BY id LIMIT 1", [$orgId]);
        } finally {
            $db->statement('RESET ROLE');
        }
        if ($owner === null) {
            $this->error('No active owner found for this organization.');

            return self::FAILURE;
        }
        $row = $db->selectOne('SELECT set_organization_disabled(?::jsonb) AS result', [json_encode([
            'org_id' => $orgId, 'disabled' => $status === 'disabled', 'reason' => $reason ?: null,
            'actor_membership_id' => $owner->id, 'audit_id' => (string) Str::uuid(),
        ], JSON_THROW_ON_ERROR)]);
        $result = json_decode($row->result, true, flags: JSON_THROW_ON_ERROR);
        $this->info($result['changed'] ? "Organization {$orgId} is {$status}." : "Organization {$orgId} was already {$status}.");

        return self::SUCCESS;
    }
}
