<?php

namespace App\Auth;

use App\Support\Platform;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Auth\UserProvider;

final class PlatformUserProvider implements UserProvider
{
    public function __construct(private Platform $platform) {}

    public function retrieveById($identifier): ?Authenticatable
    {
        $result = $this->platform->whoami($identifier);

        return $result['ok'] ? new AdminUser($identifier, $result['name'], $result['email'], $result['must_change_password']) : null;
    }

    public function retrieveByToken($identifier, $token): ?Authenticatable
    {
        return null;
    }

    public function updateRememberToken(Authenticatable $user, $token): void {}

    public function retrieveByCredentials(array $credentials): ?Authenticatable
    {
        return null;
    }

    public function validateCredentials(Authenticatable $user, array $credentials): bool
    {
        return false;
    }

    public function rehashPasswordIfRequired(Authenticatable $user, array $credentials, bool $force = false): void {}
}
