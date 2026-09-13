<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The org-level registration rate limit
 * (App\Http\Controllers\DeviceRegistrationController) clears itself after
 * 24 hours regardless — that's the guaranteed way out that needs nobody.
 * This command exists for the faster path, when a real install day hits
 * it and 24 hours is too long to wait: whoever operates the deployment
 * (not necessarily whoever built it) clears it immediately.
 */
class ClearRegistrationLockout extends Command
{
    protected $signature = 'clintra:clear-registration-lockout {org_id : The organization whose registration lockout should be cleared}';

    protected $description = 'Clears the per-org registration attempt limit immediately, instead of waiting for its 24-hour expiry';

    public function handle(): int
    {
        $orgId = $this->argument('org_id');

        RateLimiter::clear('device-register:org:'.$orgId);

        $this->info("Registration lockout cleared for org {$orgId}.");

        return self::SUCCESS;
    }
}
