<?php

namespace App\Console\Commands;

use App\Support\AdminCliLog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;

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
            return AdminCliLog::run($status === 'enabled' ? 'cli.org_enable' : 'cli.org_disable', function () {
                $this->error('Provide an organization UUID, enabled or disabled, and a reason of 1 to 200 characters when disabling.');

                return self::INVALID;
            }, fn () => ['target_id' => $orgId]);
        }

        $hostUser = function_exists('posix_geteuid') && function_exists('posix_getpwuid')
            ? (posix_getpwuid(posix_geteuid())['name'] ?? '')
            : (getenv('USERNAME') ?: getenv('USER') ?: get_current_user());
        $row = DB::connection('pgsql_owner')->selectOne(
            'SELECT platform.cli_set_org_disabled(?::uuid,?::boolean,?,?::uuid,?) AS result',
            [$orgId, $status === 'disabled' ? 'true' : 'false', $reason ?: null, (string) Uuid::uuid4(), $hostUser],
        );
        $result = json_decode($row->result, true, flags: JSON_THROW_ON_ERROR);
        if (! $result['ok']) {
            if ($result['reason'] === 'unchanged') {
                $this->info("Organization {$orgId} was already {$status}.");

                return self::SUCCESS;
            }
            $this->error('Organization status refused: '.$result['reason'].'.');

            return self::FAILURE;
        }
        $this->info("Organization {$orgId} is {$status}.");

        return self::SUCCESS;
    }
}
