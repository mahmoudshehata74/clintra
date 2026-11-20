<?php

namespace Tests\Support;

use App\Models\Device;
use App\Support\Identity\Password;
use App\Support\Identity\ProofMessage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/**
 * Builds organizations, people, credentials and signed requests for the
 * identity tests (tests/Feature/Identity), on the real HTTP stack and the
 * real database. Fixture rows go in through clintra_fixtures, as everywhere
 * (RlsFixtures); every organization made here is tracked, and the rows the
 * API wrote for it are removed after each test (cleanup(), registered to run
 * before RlsFixtures removes the fixtures).
 */
final class IdentityHarness
{
    /**
     * An organization with one location, an active owner (username "owner",
     * a password set) and one registered device with its token. $enforced
     * sets identity_enforced_at; $bindDeviceKey binds a device key.
     *
     * @return array{orgId: string, locationId: string, ownerId: string, ownerUserId: string, ownerPhone: string, deviceId: string, token: string, deviceKey: ?TestKey}
     */
    public static function org(bool $enforced = false, bool $bindDeviceKey = true): array
    {
        $test = test();
        $orgId = $test->makeOrganization('identity-'.Str::random(6));
        $test->cleanupFirst(fn () => self::cleanup($orgId));
        $locationId = $test->makeLocation($orgId);
        $phone = '+2010'.random_int(10000000, 99999999);
        $ownerUserId = $test->makeUser('owner');
        $test->fx()->table('users')->where('id', $ownerUserId)->update(['phone' => $phone]);
        $ownerId = $test->makeMembership($ownerUserId, $orgId, ['role' => 'owner', 'username' => 'owner']);
        self::setPassword($orgId, $ownerId, 'owner password 1');
        $deviceId = $test->makeDevice($orgId, $locationId, $ownerId);
        $token = (new Device(['id' => $deviceId]))->createToken('identity-device', ['membership:'.$ownerId])->plainTextToken;

        $deviceKey = null;
        if ($bindDeviceKey) {
            $deviceKey = TestKey::make();
            $test->fx()->table('device')->where('id', $deviceId)->update([
                'public_key' => json_encode($deviceKey->jwk), 'public_key_bound_at' => now()->toIso8601String(),
            ]);
        }

        if ($enforced) {
            $test->fx()->table('organizations')->where('id', $orgId)->update(['identity_enforced_at' => now()->toIso8601String()]);
        }

        return [
            'orgId' => $orgId, 'locationId' => $locationId, 'ownerId' => $ownerId, 'ownerUserId' => $ownerUserId,
            'ownerPhone' => $phone, 'deviceId' => $deviceId, 'token' => $token, 'deviceKey' => $deviceKey,
        ];
    }

    /** A member of $org with a username and, when given, a password (must_change as a reset leaves it). */
    public static function member(array $org, string $role = 'assistant', array $permissions = [], ?string $username = null, ?string $password = null, array $overrides = []): string
    {
        $test = test();
        $membershipId = $test->makeMembership($test->makeUser('member-'.Str::random(6)), $org['orgId'], array_merge([
            'role' => $role,
            'username' => $username,
            'permissions' => '{'.implode(',', $permissions).'}',
        ], $overrides));

        if ($password !== null) {
            self::setPassword($org['orgId'], $membershipId, $password, mustChange: false);
        }

        return $membershipId;
    }

    public static function setPassword(string $orgId, string $membershipId, string $password, bool $mustChange = false): void
    {
        test()->fx()->table('member_passwords')->updateOrInsert(['membership_id' => $membershipId], [
            'org_id' => $orgId, 'password_hash' => Password::hash($password), 'must_change' => $mustChange,
            'set_at' => now()->toIso8601String(),
        ]);
    }

    /**
     * A live credential of $membershipId on the device (another device of the
     * organization when $deviceId is given).
     *
     * @return array{id: string, key: TestKey, membershipId: string}
     */
    public static function credential(array $org, string $membershipId, ?string $deviceId = null): array
    {
        $key = TestKey::make();
        $id = test()->makeMemberCredential($org['orgId'], $membershipId, $deviceId ?? $org['deviceId'], $key->jwk);

        return ['id' => $id, 'key' => $key, 'membershipId' => $membershipId];
    }

    public static function nonce(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
    }

    /** The device proof header of a request whose body is $body. */
    public static function deviceProof(TestKey $key, string $method, string $uri, string $body, ?int $unixMs = null, ?string $nonce = null): string
    {
        $unixMs ??= now()->getTimestampMs();
        $nonce ??= self::nonce();

        return 'v1.'.$unixMs.'.'.$nonce.'.'.$key->sign(ProofMessage::request($method, $uri, $unixMs, $nonce, $body));
    }

    /** @param  array{id: string, key: TestKey}  $credential */
    public static function personProof(array $credential, string $method, string $uri, string $body, ?int $unixMs = null, ?string $nonce = null): string
    {
        $unixMs ??= now()->getTimestampMs();
        $nonce ??= self::nonce();

        return 'v1.'.$credential['id'].'.'.$unixMs.'.'.$nonce.'.'
            .$credential['key']->sign(ProofMessage::request($method, $uri, $unixMs, $nonce, $body));
    }

    /**
     * Sends a JSON request with the device token, the device proof when the
     * device has a key, and a person proof when $credential is given — each
     * signed over exactly the body the test client sends.
     *
     * @param  array<string, mixed>  $data
     * @param  array{id: string, key: TestKey}|null  $credential
     * @param  array<string, string>  $headers
     */
    public static function send(array $org, string $method, string $uri, array $data = [], ?array $credential = null, array $headers = []): TestResponse
    {
        $body = json_encode($data);
        $test = test();
        $test->flushHeaders();

        if ($org['deviceKey'] !== null && ! array_key_exists('X-Clintra-Device-Proof', $headers)) {
            $headers['X-Clintra-Device-Proof'] = self::deviceProof($org['deviceKey'], $method, $uri, $body);
        }
        if ($credential !== null && ! array_key_exists('X-Clintra-Person-Proof', $headers)) {
            $headers['X-Clintra-Person-Proof'] = self::personProof($credential, $method, $uri, $body);
        }

        return $test->withToken($org['token'])->withHeaders($headers)->json($method, $uri, $data);
    }

    /**
     * $op with credential_id and proof, signed by $credential over the op as
     * the test client will send it.
     *
     * @param  array<string, mixed>  $op
     * @param  array{id: string, key: TestKey}  $credential
     * @return array<string, mixed>
     */
    public static function signOp(array $org, array $op, array $credential): array
    {
        $op['credential_id'] = $credential['id'];
        $raw = json_decode(json_encode($op));
        $op['proof'] = $credential['key']->sign(ProofMessage::op($raw, $org['deviceId'], $credential['id']));

        return $op;
    }

    /**
     * @param  array<string, mixed>  $row
     * @param  array{id: string, key: TestKey}  $credential
     * @return array<string, mixed>
     */
    public static function signAuditRow(array $org, array $row, array $credential): array
    {
        $row['credential_id'] = $credential['id'];
        $raw = json_decode(json_encode($row));
        $row['proof'] = $credential['key']->sign(ProofMessage::audit($raw, $org['deviceId'], $credential['id']));

        return $row;
    }

    /** Every row the API wrote for these organizations, before RlsFixtures removes the fixtures. */
    public static function cleanup(string ...$orgIds): void
    {
        $fx = test()->fx();
        $locationIds = $fx->table('locations')->whereIn('org_id', $orgIds)->pluck('id')->all();

        $fx->table('device_audit_log')->whereIn('org_id', $orgIds)->delete();
        $fx->table('sync_ledger')->whereIn('org_id', $orgIds)->delete();
        $fx->table('audit_log')->whereIn('org_id', $orgIds)->delete();
        $fx->table('login_attempts')->whereIn('org_id', $orgIds)->delete();
        $fx->table('member_credentials')->whereIn('org_id', $orgIds)->delete();
        $fx->table('member_passwords')->whereIn('org_id', $orgIds)->delete();
        $invoiceIds = $fx->table('invoices')->whereIn('org_id', $orgIds)->pluck('id')->all();
        $fx->table('invoice_items')->whereIn('invoice_id', $invoiceIds)->delete();
        $fx->table('invoices')->whereIn('id', $invoiceIds)->delete();
        $fx->table('visits')->whereIn('org_id', $orgIds)->delete();
        $fx->table('patients')->whereIn('org_id', $orgIds)->delete();
        $fx->table('services')->whereIn('org_id', $orgIds)->delete();
        $fx->table('message_templates')->whereIn('org_id', $orgIds)->delete();
        $fx->table('schedules')->whereIn('location_id', $locationIds)->delete();
        $fx->table('cash_close')->whereIn('location_id', $locationIds)->delete();
        $fx->table('activation_codes')->whereIn('org_id', $orgIds)->delete();
        $memberIds = $fx->table('memberships')->whereIn('org_id', $orgIds)->pluck('id')->all();
        $fx->table('membership_locations')->whereIn('membership_id', $memberIds)->delete();
    }
}
