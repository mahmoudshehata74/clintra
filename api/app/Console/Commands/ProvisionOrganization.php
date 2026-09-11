<?php

namespace App\Console\Commands;

use App\Support\EgyptianPhone;
use App\Support\PinHash;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;

/**
 * The install-team flow's backend (design reference screen 1) — provisions
 * the very first organization, since clintra_app and clintra_owner are both
 * fully RLS-bound and can never create one themselves (api/docs/rls.md's
 * "Provisioning: the one door into an empty database"). This command is
 * the install tool acting as a client, so — unlike the app at request
 * time — it generates every id itself and calls provision_organization()
 * once with all of them.
 */
class ProvisionOrganization extends Command
{
    protected $signature = 'clintra:provision';

    protected $description = 'Provisions the first organization, location, owner user, practitioner, and owner membership';

    public function handle(): int
    {
        $orgName = $this->ask('Organization name');
        $locationName = $this->ask('Location name');
        $locationAddress = $this->ask('Location address');
        $locationPhone = $this->promptForPhone('Location phone');

        $doctorFullName = $this->ask("Doctor's full name");
        $doctorPhone = $this->promptForPhone("Doctor's phone");

        $pin = $this->promptForPin();

        $specialtyId = $this->generalSpecialtyTemplateId();

        $pinSalt = PinHash::generateSalt();
        $pinHash = PinHash::hash($pin, $pinSalt);
        unset($pin);

        $payload = [
            'org_id' => (string) Str::uuid(),
            'org_name' => $orgName,
            'plan_tier' => 'small',
            'location_id' => (string) Str::uuid(),
            'location_name' => $locationName,
            'location_address' => $locationAddress,
            'location_phone' => $locationPhone,
            'user_id' => (string) Str::uuid(),
            'user_full_name' => $doctorFullName,
            'user_phone' => $doctorPhone,
            'practitioner_id' => (string) Str::uuid(),
            'practitioner_title' => 'طبيب عام',
            'specialty_id' => $specialtyId,
            'practitioner_location_id' => (string) Str::uuid(),
            'membership_id' => (string) Str::uuid(),
            'pin_hash' => $pinHash,
            'pin_salt' => $pinSalt,
            'audit_organization_id' => (string) Str::uuid(),
            'audit_location_id' => (string) Str::uuid(),
            'audit_user_id' => (string) Str::uuid(),
            'audit_practitioner_id' => (string) Str::uuid(),
            'audit_practitioner_location_id' => (string) Str::uuid(),
            'audit_membership_id' => (string) Str::uuid(),
        ];

        $row = DB::connection('pgsql_owner')->selectOne(
            'select provision_organization(?::jsonb) as result',
            [json_encode($payload, JSON_THROW_ON_ERROR)],
        );
        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);

        $this->newLine();
        $this->info('Organization provisioned.');
        $this->table(['field', 'id'], [
            ['organization_id', $result['organization_id']],
            ['location_id', $result['location_id']],
            ['user_id', $result['user_id'].($result['user_is_new'] ? ' (new)' : ' (existing — reused by phone)')],
            ['practitioner_id', $result['practitioner_id']],
            ['practitioner_location_id', $result['practitioner_location_id']],
            ['membership_id', $result['membership_id']],
        ]);

        return self::SUCCESS;
    }

    /** Bounds every retry loop below — input that can never be gathered (a broken/non-interactive
     * terminal) must fail loudly instead of spinning forever re-asking the same question. */
    private const MAX_PROMPT_ATTEMPTS = 5;

    private function promptForPhone(string $label): string
    {
        for ($attempt = 1; $attempt <= self::MAX_PROMPT_ATTEMPTS; $attempt++) {
            $input = $this->ask($label);

            try {
                return EgyptianPhone::normalize((string) $input);
            } catch (InvalidArgumentException) {
                $this->error('That does not look like a valid Egyptian phone number — try again.');
            }
        }

        throw new \RuntimeException("Could not read a valid phone number for \"{$label}\" after ".self::MAX_PROMPT_ATTEMPTS.' attempts.');
    }

    private function promptForPin(): string
    {
        for ($attempt = 1; $attempt <= self::MAX_PROMPT_ATTEMPTS; $attempt++) {
            $pin = $this->secret('PIN (4 digits)');

            if (! is_string($pin) || ! preg_match('/^\d{4}$/', $pin)) {
                $this->error('The PIN must be exactly 4 digits.');

                continue;
            }

            $confirmation = $this->secret('Confirm PIN');

            if ($pin !== $confirmation) {
                $this->error('The PINs did not match — try again.');

                continue;
            }

            return $pin;
        }

        throw new \RuntimeException('Could not read a valid, confirmed 4-digit PIN after '.self::MAX_PROMPT_ATTEMPTS.' attempts.');
    }

    private function generalSpecialtyTemplateId(): string
    {
        $data = json_decode(
            file_get_contents(base_path('../contract/reference-data.json')),
            associative: true,
            flags: JSON_THROW_ON_ERROR,
        );

        $general = collect($data['specialty_templates'])->firstWhere('key', 'general');

        if ($general === null) {
            throw new \RuntimeException('contract/reference-data.json has no "general" specialty_templates row.');
        }

        return $general['id'];
    }
}
