<?php

namespace App\Console\Commands;

use App\Support\AdminCliLog;
use App\Support\AdminEnrollment;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Ramsey\Uuid\Uuid;

class CreateAdmin extends Command
{
    protected $signature = 'clintra:admin:create {email} {name}';

    protected $description = 'Creates a platform administrator and prints enrollment secrets once';

    public function handle(): int
    {
        $id = (string) Uuid::uuid4();

        return AdminCliLog::run('cli.admin_create', function () use ($id) {
            $email = strtolower(trim((string) $this->argument('email')));
            $name = trim((string) $this->argument('name'));
            if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || mb_strlen($name) < 1 || mb_strlen($name) > 120) {
                $this->error('Provide a valid email and a name of 1 to 120 characters.');

                return self::INVALID;
            }
            $db = DB::connection('pgsql_owner');
            if ($db->table('platform.admin_users')->where('email', $email)->exists()) {
                $this->error('An administrator already uses that email.');

                return self::INVALID;
            }
            $password = bin2hex(random_bytes(16));
            $secret = random_bytes(20);
            $db->insert(<<<'SQL'
                INSERT INTO platform.admin_users(id,email,name,password_hash,totp_secret)
                VALUES (?::uuid,?,?,platform_crypto.crypt(?,platform_crypto.gen_salt('bf',12)),decode(?,'hex'))
            SQL, [$id, $email, $name, $password, bin2hex($secret)]);
            $codes = [];
            for ($i = 0; $i < 10; $i++) {
                $code = bin2hex(random_bytes(16));
                $db->insert('INSERT INTO platform.admin_recovery_codes(id,admin_user_id,code_hash) VALUES (?::uuid,?::uuid,?)', [
                    (string) Uuid::uuid4(), $id, hash('sha256', $code),
                ]);
                $codes[] = $code;
            }
            $uri = 'otpauth://totp/'.rawurlencode('Clintra:'.$email).'?secret='.AdminEnrollment::base32($secret)
                .'&issuer=Clintra&algorithm=SHA1&digits=6&period=30';
            $this->info("Administrator {$id} created.");
            $this->warn('Save these enrollment secrets now; they are shown once.');
            $this->line('Password: '.$password);
            $this->line('TOTP URI: '.$uri);
            $this->line('Recovery codes:');
            foreach ($codes as $code) {
                $this->line($code);
            }

            return self::SUCCESS;
        }, fn () => ['target_id' => $id]);
    }
}
