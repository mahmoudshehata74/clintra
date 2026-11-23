<?php

// Test-only API-side fixture process. The panel receives none of these credentials.
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->loadEnvironmentFrom('.env.testing');
$app->make(Kernel::class)->bootstrap();

try {
    $db = DB::connection('pgsql_owner');
    $fx = DB::connection('pgsql_fixtures');
    foreach ([$db, $fx] as $connection) {
        if ($connection->getConfig('database') !== 'clintra_test') {
            throw new RuntimeException('Panel fixtures require clintra_test.');
        }
        if ($connection->selectOne('SELECT current_database() AS name')->name !== 'clintra_test') {
            throw new RuntimeException('Panel fixtures require clintra_test.');
        }
    }
    $command = $argv[1] ?? '';
    $id = $argv[2] ?? '';
    $commands = ['create', 'clinic', 'log-row', 'otp', 'wrong-otp', 'idle', 'expired', 'inactive', 'retire', 'sessions', 'org-state'];
    if (! in_array($command, $commands, true)) {
        throw new RuntimeException('Unknown fixture command.');
    }
    $admin = null;
    if ($command !== 'create') {
        if (! Str::isUuid($id)) {
            throw new RuntimeException('Unknown panel fixture.');
        }
        $admin = $db->table('platform.admin_users')->where('id', $id)->first();
        if (! $admin || ! preg_match('/^b[34]-[0-9a-f-]{36}@example\.invalid$/D', $admin->email)) {
            throw new RuntimeException('Only b3-/b4- fixture accounts are allowed.');
        }
    }
    $extra = ($argv[3] ?? '') === '' ? '{}' : $argv[3];
    if ($command === 'create') {
        $id = (string) Str::uuid();
        $email = 'b4-'.$id.'@example.invalid';
        $password = 'Panel-fixture-password-123';
        $secret = '12345678901234567890';
        $recovery = 'recovery-'.Str::uuid();
        $session = (string) Str::uuid();
        $org = (string) Str::uuid();
        $orgName = 'عيادة التجربة '.substr($id, 0, 8);
        $db->insert("INSERT INTO platform.admin_users(id,email,name,password_hash,totp_secret,must_change_password) VALUES (?::uuid,?,'مسؤول التجربة',platform_crypto.crypt(?,platform_crypto.gen_salt('bf',12)),decode(?,'hex'),?::boolean)", [$id, $email, $password, bin2hex($secret), ($argv[2] ?? '') === 'must' ? 'true' : 'false']);
        $db->table('platform.admin_recovery_codes')->insert(['id' => (string) Str::uuid(), 'admin_user_id' => $id, 'code_hash' => hash('sha256', $recovery)]);
        $db->insert("INSERT INTO platform.admin_sessions(id,admin_user_id,expires_at,ip,user_agent) VALUES (?::uuid,?::uuid,now()+interval '8 hours','192.0.2.200','Panel fixture')", [$session, $id]);
        $fx->table('organizations')->insert(['id' => $org, 'name' => $orgName, 'plan_tier' => 'small', 'created_at' => now()->toIso8601String()]);
        $logIds = [];
        foreach (['org.disable', 'org.enable', 'org.disable', 'org.enable'] as $action) {
            $logId = (string) Str::uuid();
            $logIds[] = $logId;
            $db->table('platform.admin_log')->insert(['id' => $logId, 'admin_user_id' => $id, 'org_id' => $org, 'action' => $action,
                'succeeded' => true, 'detail' => json_encode(['fixture' => '<script>alert(1)</script>'], JSON_THROW_ON_ERROR)]);
        }
        $result = compact('id', 'email', 'password', 'secret', 'recovery', 'session', 'org', 'orgName', 'logIds');
    } else {
        $org = $db->table('platform.admin_log')->where('admin_user_id', $id)->whereNotNull('org_id')->orderBy('seq')->value('org_id');
        $result = ['ok' => true];
        if ($command === 'clinic') {
            $payload = json_decode($extra, true, flags: JSON_THROW_ON_ERROR);
            if (isset($payload['name'])) {
                $fx->table('organizations')->where('id', $org)->update(['name' => $payload['name']]);
            }
            $location = $fx->table('locations')->where('org_id', $org)->value('id');
            if ($location) {
                if (isset($payload['location'])) {
                    $fx->table('locations')->where('id', $location)->update(['name' => $payload['location']]);
                }
            } else {
                $location = (string) Str::uuid();
                $specialty = (string) Str::uuid();
                $doctor = (string) Str::uuid();
                $user = (string) Str::uuid();
                $member = (string) Str::uuid();
                $patient = (string) Str::uuid();
                $invoice = (string) Str::uuid();
                $fx->table('locations')->insert(['id' => $location, 'org_id' => $org, 'name' => $payload['location'] ?? 'فرع التجربة', 'address' => 'Fixture', 'phone' => 'fixture', 'is_active' => true]);
                $fx->table('specialty_templates')->insert(['id' => $specialty, 'org_id' => $org, 'key' => 'b4-'.$id, 'name' => 'Fixture', 'generation' => 'none', 'pricing_mode' => 'per_item', 'unit_label' => 'unit', 'provider_label' => 'provider']);
                $fx->table('practitioners')->insert(['id' => $doctor, 'org_id' => $org, 'full_name' => 'Fixture', 'specialty_id' => $specialty, 'title' => 'Dr.', 'is_active' => true]);
                $fx->table('users')->insert(['id' => $user, 'full_name' => 'Fixture', 'phone' => 'b4-'.$id, 'is_active' => true]);
                $fx->table('memberships')->insert(['id' => $member, 'user_id' => $user, 'org_id' => $org, 'role' => 'assistant', 'location_scope' => 'all', 'practitioner_scope' => 'all', 'pin_hash' => 'fixture', 'pin_salt' => 'fixture', 'is_active' => true]);
                $fx->table('patients')->insert(['id' => $patient, 'org_id' => $org, 'full_name' => 'Fixture', 'created_at' => now()->toIso8601String()]);
                $fx->table('invoices')->insert(['id' => $invoice, 'org_id' => $org, 'location_id' => $location, 'number' => 1, 'series' => 1, 'issued_year' => 2026,
                    'patient_id' => $patient, 'practitioner_id' => $doctor, 'total' => 12345, 'paid' => 10001, 'status' => 'partial', 'issued_at' => '2026-07-01T00:00:00+03:00']);
                $fx->table('payments')->insert(['id' => (string) Str::uuid(), 'invoice_id' => $invoice, 'location_id' => $location, 'series' => 1, 'receipt_number' => 'B4-1',
                    'amount' => 10001, 'method' => 'cash', 'after_close' => false, 'created_by' => $member, 'created_at' => '2026-07-01T23:59:59+03:00']);
            }
            $result = compact('org', 'location');
        } elseif ($command === 'log-row') {
            $payload = json_decode($extra, true, flags: JSON_THROW_ON_ERROR);
            $logId = (string) Str::uuid();
            $db->table('platform.admin_log')->insert(['id' => $logId, 'admin_user_id' => ($payload['anonymous'] ?? false) ? null : $id,
                'org_id' => $org, 'action' => $payload['action'], 'succeeded' => $payload['succeeded'] ?? false, 'reason' => $payload['reason'] ?? null,
                'user_agent' => $payload['user_agent'] ?? null, 'detail' => json_encode((object) ($payload['detail'] ?? []), JSON_THROW_ON_ERROR)]);
            $result = ['id' => $logId];
        } elseif ($command === 'otp' || $command === 'wrong-otp') {
            $secret = hex2bin($db->selectOne("SELECT encode(totp_secret,'hex') AS secret FROM platform.admin_users WHERE id=?", [$id])->secret);
            $step = (int) $db->selectOne('SELECT floor(extract(epoch FROM now())/30) AS step')->step + (int) ($argv[3] ?? 0);
            $otp = static function (int $counter) use ($secret): string {
                $digest = hash_hmac('sha1', pack('N2', intdiv($counter, 4294967296), $counter & 0xFFFFFFFF), $secret, true);
                $offset = ord($digest[19]) & 15;
                return sprintf('%06d', (unpack('N', substr($digest, $offset, 4))[1] & 0x7FFFFFFF) % 1000000);
            };
            $code = $otp($step);
            if ($command === 'wrong-otp') {
                $valid = array_map($otp, range($step - 2, $step + 2));
                $candidate = 0;
                while (in_array(sprintf('%06d', $candidate), $valid, true)) {
                    $candidate++;
                }
                $code = sprintf('%06d', $candidate);
            }
            $result = ['otp' => $code];
        } elseif ($command === 'idle') {
            $db->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE admin_user_id=? AND ended_at IS NULL", [$id]);
        } elseif ($command === 'expired') {
            $db->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE admin_user_id=? AND ended_at IS NULL', [$id]);
        } elseif (in_array($command, ['inactive', 'retire'], true)) {
            $db->table('platform.admin_users')->where('id', $id)->update(['is_active' => false]);
            $db->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=? AND ended_at IS NULL', [$id]);
            if ($command === 'retire') {
                // Immutable log rows keep the organization; only test clinical fixtures are removed.
                $invoices = $fx->table('invoices')->where('org_id', $org)->pluck('id');
                $users = $fx->table('memberships')->where('org_id', $org)->pluck('user_id');
                $fx->table('payments')->whereIn('invoice_id', $invoices)->delete();
                foreach (['invoices', 'memberships', 'practitioners', 'patients', 'locations', 'specialty_templates'] as $table) {
                    $fx->table($table)->where('org_id', $org)->delete();
                }
                $fx->table('users')->whereIn('id', $users)->delete();
            }
        } elseif ($command === 'sessions') {
            $result = ['sessions' => $db->table('platform.admin_sessions')->where('admin_user_id', $id)->get(['id', 'ended_at'])->toArray()];
        } elseif ($command === 'org-state') {
            $result = (array) $fx->table('organizations')->where('id', $org)->first(['disabled_at', 'disabled_reason']);
        }
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
} catch (Throwable $error) {
    fwrite(STDERR, $error->getMessage()."\n");
    exit(1);
}
