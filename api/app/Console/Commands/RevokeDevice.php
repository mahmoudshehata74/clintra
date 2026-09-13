<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Kills a lost or stolen device's access — docs/dry-run.md's scenario 18,
 * a real finding from the manual dry run (there was previously no way to
 * do this at all).
 *
 * Deliberately **not** a fourth SECURITY DEFINER/BYPASSRLS function.
 * Revocation has none of the circular dependencies provisioning,
 * minting, and registration each exist to break (a membership needing an
 * org that needs a membership; a device with no membership yet) — the
 * org this device belongs to already has an active owner membership to
 * act as. So this runs as plain `clintra_owner` on the `pgsql_owner`
 * connection, using the exact same mechanism `App\Support\DatabaseSession`
 * uses for every ordinary authenticated request: declare a membership via
 * `set_config('app.membership_id', ..., true)`, then let RLS's own
 * `device_scope` policy (`org_id = current_org()`) allow the write.
 * `personal_access_tokens` needs no RLS consideration at all — it carries
 * none, and `clintra_owner` owns the table outright (both confirmed
 * empirically before this was written, not assumed from the schema).
 *
 * The one real gap: to know *which* membership to declare, this needs to
 * read `device.org_id` and find that org's active owner membership id —
 * both RLS-protected reads, unreadable before a membership is declared,
 * the same chicken-and-egg every bootstrap door in this schema solves
 * somehow. Solved here without a new role: `clintra_owner` is already a
 * plain member of `clintra_rls` (granted when the RLS helper functions
 * were created), and `clintra_rls` already holds `SELECT` on both `device`
 * and `memberships` (it needs them for `current_org()`'s own body) — so
 * this command does `SET ROLE clintra_rls` for exactly that one lookup,
 * `RESET ROLE` immediately after, then proceeds as `clintra_owner` for
 * every actual write. No new grant, no new role, no new function.
 *
 * The elevated window (`lookupUnderElevatedRole` below) is a `try`/`finally`,
 * not just a statement that happens to come after the two reads: `RESET
 * ROLE` must run even if a `SELECT` itself throws (a malformed row, a
 * dropped connection mid-query, the device genuinely not existing), not
 * only on the two success paths this command anticipated. This is
 * deliberately not left to Postgres's own "a plain `SET` issued inside an
 * aborted transaction reverts on `ROLLBACK`" behavior — true, but a fact
 * about the database's rollback semantics, not a guarantee this command's
 * own code makes and can be read, tested, and trusted on its own terms.
 */
class RevokeDevice extends Command
{
    protected $signature = 'clintra:revoke-device {device_id : The device to revoke}';

    protected $description = 'Revokes a device: deletes its Sanctum token(s) and marks it permanently unusable';

    public function handle(): int
    {
        $deviceId = $this->argument('device_id');
        $connection = DB::connection('pgsql_owner');

        $result = $connection->transaction(function () use ($connection, $deviceId) {
            [$device, $ownerMembership] = $this->lookupUnderElevatedRole($connection, $deviceId);

            if ($device->revoked_at !== null) {
                return ['already_revoked' => true, 'org_id' => $device->org_id, 'revoked_at' => $device->revoked_at, 'tokens_revoked' => 0];
            }

            $connection->select("select set_config('app.membership_id', ?, true)", [$ownerMembership->id]);

            $now = now()->toIso8601String();
            $connection->table('device')->where('id', $deviceId)->update(['revoked_at' => $now]);
            $tokensRevoked = $connection->table('personal_access_tokens')
                ->where('tokenable_id', $deviceId)
                ->where('tokenable_type', 'App\\Models\\Device')
                ->delete();

            $connection->table('audit_log')->insert([
                'id' => (string) Str::uuid(),
                'org_id' => $device->org_id,
                'actor_membership_id' => $ownerMembership->id,
                'entity' => 'device',
                'entity_id' => $deviceId,
                'action' => 'update',
                'before' => json_encode(['revoked_at' => null]),
                'after' => json_encode(['revoked_at' => $now]),
                'at' => $now,
            ]);

            return ['already_revoked' => false, 'org_id' => $device->org_id, 'revoked_at' => $now, 'tokens_revoked' => $tokensRevoked];
        });

        $this->newLine();

        if ($result['already_revoked']) {
            $this->warn("Device {$deviceId} was already revoked, at {$result['revoked_at']}.");

            return self::SUCCESS;
        }

        $this->info("Device {$deviceId} (org {$result['org_id']}) revoked at {$result['revoked_at']}.");
        $this->line("{$result['tokens_revoked']} token(s) deleted. Any request from this device now fails authentication immediately.");

        return self::SUCCESS;
    }

    /**
     * The only place this command ever runs as clintra_rls — exactly two
     * reads (device, then that org's owner membership), no writes. `RESET
     * ROLE` is guaranteed by `finally`, regardless of which of the two
     * `selectOne` calls throws, or whether either returns null and this
     * method throws its own exception instead.
     *
     * @return array{0: object{org_id: string, revoked_at: ?string}, 1: object{id: string}}
     */
    private function lookupUnderElevatedRole(Connection $connection, string $deviceId): array
    {
        $connection->statement('SET ROLE clintra_rls');

        try {
            $device = $connection->selectOne('select org_id, revoked_at from device where id = ?', [$deviceId]);

            if ($device === null) {
                throw new RuntimeException("No device found with id {$deviceId}.");
            }

            $ownerMembership = $connection->selectOne(
                "select id from memberships where org_id = ? and role = 'owner' and is_active = true order by id limit 1",
                [$device->org_id],
            );

            if ($ownerMembership === null) {
                throw new RuntimeException("Organization {$device->org_id} has no active owner membership to attribute this action to.");
            }

            return [$device, $ownerMembership];
        } finally {
            $connection->statement('RESET ROLE');
        }
    }
}
