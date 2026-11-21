<?php

namespace App\Auth;

use Filament\Models\Contracts\FilamentUser;
use Filament\Models\Contracts\HasName;
use Filament\Panel;
use Illuminate\Contracts\Auth\Authenticatable;

final class AdminUser implements Authenticatable, FilamentUser, HasName
{
    public function __construct(private string $sessionId, public string $name, public string $email, public bool $must_change_password) {}

    public function getKey(): string
    {
        return hash('sha256', $this->sessionId);
    }

    public function receivesBroadcastNotificationsOn(): ?string
    {
        return null;
    }

    public function getAuthIdentifierName(): string
    {
        return 'platform_session_id';
    }

    public function getAuthIdentifier(): mixed
    {
        return $this->sessionId;
    }

    public function getAuthPasswordName(): string
    {
        return '';
    }

    public function getAuthPassword(): string
    {
        return '';
    }

    public function getRememberToken(): ?string
    {
        return null;
    }

    public function setRememberToken($value): void {}

    public function getRememberTokenName(): string
    {
        return '';
    }

    public function canAccessPanel(Panel $panel): bool
    {
        return $panel->getId() === 'admin';
    }

    public function getFilamentName(): string
    {
        return $this->name;
    }
}
