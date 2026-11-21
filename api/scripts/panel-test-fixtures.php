<?php

// Test-only fixture setup runs on the API side, outside the panel process and its credentials.
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->loadEnvironmentFrom('.env.testing');
$app->make(Kernel::class)->bootstrap();
if (config('database.connections.pgsql_owner.database') !== 'clintra_test') {
    fwrite(STDERR, "Panel fixtures require clintra_test.\n");
    exit(1);
}
$db = DB::connection('pgsql_owner');
$command = $argv[1] ?? '';
$id = $argv[2] ?? '';
if ($command !== 'create' && ! $db->table('platform.admin_users')->where('id', $id)->where('email', 'like', 'b3-%@example.invalid')->exists()) {
    fwrite(STDERR, "Unknown panel fixture.\n");
    exit(1);
}
if ($command === 'create') {
    $id = (string) Str::uuid();
    $email = 'b3-'.$id.'@example.invalid';
    $password = 'Panel-fixture-password-123';
    $secret = '12345678901234567890';
    $must = ($argv[2] ?? '') === 'must';
    $recovery = 'recovery-'.Str::uuid();
    $db->insert("INSERT INTO platform.admin_users(id,email,name,password_hash,totp_secret,must_change_password) VALUES (?::uuid,?,'مسؤول التجربة',platform_crypto.crypt(?,platform_crypto.gen_salt('bf',12)),decode(?,'hex'),?::boolean)", [$id, $email, $password, bin2hex($secret), $must ? 'true' : 'false']);
    $db->insert('INSERT INTO platform.admin_recovery_codes(id,admin_user_id,code_hash) VALUES (?::uuid,?::uuid,?)', [(string) Str::uuid(), $id, hash('sha256', $recovery)]);
    $session = (string) Str::uuid();
    $db->insert("INSERT INTO platform.admin_sessions(id,admin_user_id,expires_at,ip,user_agent) VALUES (?::uuid,?::uuid,now()+interval '8 hours','192.0.2.200','Panel fixture')", [$session, $id]);
    $org = (string) Str::uuid();
    DB::connection('pgsql_fixtures')->table('organizations')->insert(['id' => $org, 'name' => 'Panel fixture', 'plan_tier' => 'small', 'created_at' => now()->toIso8601String()]);
    $logIds = [];
    foreach (['org.disable', 'org.enable', 'org.disable', 'org.enable'] as $action) {
        $logId = (string) Str::uuid();
        $logIds[] = $logId;
        $db->insert('INSERT INTO platform.admin_log(id,admin_user_id,org_id,action,succeeded,detail) VALUES (?::uuid,?::uuid,?::uuid,?,true,?::jsonb)', [$logId, $id, $org, $action, json_encode(['fixture' => '<script>alert(1)</script>'])]);
    }
    $result = compact('id', 'email', 'password', 'secret', 'recovery', 'session', 'org', 'logIds');
} elseif ($command === 'log-row') {
    $payload = json_decode($argv[3] ?? '{}', true, flags: JSON_THROW_ON_ERROR);
    $org = $db->table('platform.admin_log')->where('admin_user_id', $id)->whereNotNull('org_id')->value('org_id');
    $logId = (string) Str::uuid();
    $db->insert('INSERT INTO platform.admin_log(id,admin_user_id,org_id,action,succeeded,reason,detail,user_agent) VALUES (?::uuid,?::uuid,?::uuid,?,?::boolean,?,?::jsonb,?)', [
        $logId, ($payload['anonymous'] ?? false) ? null : $id, $org, $payload['action'], ($payload['succeeded'] ?? false) ? 'true' : 'false',
        $payload['reason'] ?? null, json_encode((object) ($payload['detail'] ?? []), JSON_THROW_ON_ERROR), $payload['user_agent'] ?? null,
    ]);
    $result = ['id' => $logId];
} elseif ($command === 'otp' || $command === 'wrong-otp') {
    $secret = hex2bin($db->selectOne("SELECT encode(totp_secret,'hex') AS secret FROM platform.admin_users WHERE id=?", [$id])->secret);
    $step = (int) $db->selectOne('SELECT floor(extract(epoch FROM now())/30) AS step')->step + (int) ($argv[3] ?? 0);
    $mac = hash_hmac('sha1', pack('N2', intdiv($step, 4294967296), $step & 0xFFFFFFFF), $secret, true);
    $offset = ord($mac[19]) & 15;
    $result = ['otp' => sprintf('%06d', (unpack('N', substr($mac, $offset, 4))[1] & 0x7FFFFFFF) % 1000000)];
    if ($command === 'wrong-otp') {
        $valid = [];
        foreach (range($step - 2, $step + 2) as $candidateStep) {
            $digest = hash_hmac('sha1', pack('N2', intdiv($candidateStep, 4294967296), $candidateStep & 0xFFFFFFFF), $secret, true);
            $offset = ord($digest[19]) & 15;
            $valid[] = sprintf('%06d', (unpack('N', substr($digest, $offset, 4))[1] & 0x7FFFFFFF) % 1000000);
        }
        $candidate = 0;
        while (in_array(sprintf('%06d', $candidate), $valid, true)) {
            $candidate++;
        }
        $result = ['otp' => sprintf('%06d', $candidate)];
    }
} elseif ($command === 'idle') {
    $db->statement("UPDATE platform.admin_sessions SET last_seen_at=now()-interval '30 minutes' WHERE admin_user_id=? AND ended_at IS NULL", [$id]);
    $result = ['ok' => true];
} elseif ($command === 'expired') {
    $db->statement('UPDATE platform.admin_sessions SET expires_at=now() WHERE admin_user_id=? AND ended_at IS NULL', [$id]);
    $result = ['ok' => true];
} elseif ($command === 'inactive' || $command === 'retire') {
    $db->table('platform.admin_users')->where('id', $id)->update(['is_active' => false]);
    $db->statement('UPDATE platform.admin_sessions SET ended_at=now() WHERE admin_user_id=? AND ended_at IS NULL', [$id]);
    $result = ['ok' => true];
} elseif ($command === 'sessions') {
    $result = ['sessions' => $db->table('platform.admin_sessions')->where('admin_user_id', $id)->get(['id', 'ended_at'])->toArray()];
} else {
    fwrite(STDERR, "Unknown fixture command.\n");
    exit(1);
}
echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
