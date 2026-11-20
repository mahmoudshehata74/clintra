<?php

use App\Support\Identity\Password;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

require __DIR__.'/../../api/vendor/autoload.php';
$app = require __DIR__.'/../../api/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$db = DB::connection('pgsql_fixtures');
if ($db->selectOne('SELECT current_database() AS name')->name !== 'clintra_test') {
    throw new RuntimeException('Identity fixtures require clintra_test');
}

[, $action, $org] = $argv;
$organization = $db->table('organizations')->where('id', $org)->where('name', 'like', 'Live Clinic %');
if (! $organization->exists()) {
    throw new RuntimeException('Identity fixtures require a live-test organization');
}

$db->transaction(function () use ($db, $organization, $action, $org) {
    if ($action === 'enforce') {
        $organization->update(['identity_enforced_at' => now()->toIso8601String()]);
        return;
    }
    if ($action === 'deactivate') {
        $db->table('memberships')->where('org_id', $org)->where('username', 'live-assistant')->update(['is_active' => false]);
        return;
    }
    if ($action !== 'prepare') {
        throw new RuntimeException('Unknown identity fixture action');
    }

    $owner = $db->table('memberships')->where('org_id', $org)->where('role', 'owner')->first();
    $assistant = (string) Str::uuid();
    $user = (string) Str::uuid();
    $db->table('users')->insert([
        'id' => $user, 'full_name' => 'Live Identity Assistant', 'phone' => '+2011'.random_int(10000000, 99999999), 'is_active' => true,
    ]);
    $db->table('memberships')->insert([
        'id' => $assistant, 'user_id' => $user, 'org_id' => $org, 'role' => 'assistant', 'is_active' => true,
        'location_scope' => 'all', 'practitioner_scope' => 'all', 'username' => 'live-assistant',
        'pin_hash' => $owner->pin_hash, 'pin_salt' => $owner->pin_salt,
    ]);
    $db->table('memberships')->where('id', $owner->id)->update(['username' => 'live-owner']);
    foreach ([$owner->id, $assistant] as $member) {
        $db->table('member_passwords')->insert([
            'membership_id' => $member, 'org_id' => $org, 'password_hash' => Password::hash('Password for this live fixture'),
            'must_change' => false, 'set_at' => now()->toIso8601String(),
        ]);
    }
});
