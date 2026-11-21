<?php

namespace App\Auth;

use App\Support\Platform;
use Illuminate\Auth\GuardHelpers;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Contracts\Auth\StatefulGuard;
use Illuminate\Contracts\Auth\UserProvider;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

final class PlatformGuard implements StatefulGuard
{
    use GuardHelpers;

    private bool $resolved = false;

    public array $lastResult = [];

    public function __construct(UserProvider $provider, private Request $request, private Platform $platform)
    {
        $this->provider = $provider;
    }

    public function user(): ?Authenticatable
    {
        if (! $this->resolved) {
            $this->resolved = true;
            $this->user = $this->provider->retrieveById($this->request->session()->get('platform_session_id'));
            if ($this->user === null) {
                $this->request->session()->forget('platform_session_id');
            }
        }

        return $this->user;
    }

    public function setRequest(Request $request): void
    {
        $this->request = $request;
        $this->resolved = false;
        $this->user = null;
    }

    public function getProvider(): UserProvider
    {
        return $this->provider;
    }

    public function attempt(array $credentials = [], $remember = false): bool
    {
        $id = (string) Str::uuid();
        $this->lastResult = $this->platform->login([
            'email' => $credentials['email'], 'password' => $credentials['password'], 'otp' => $credentials['otp'],
            'ip' => $this->request->ip(), 'user_agent' => mb_substr($this->request->userAgent() ?? '', 0, 400),
            'session_id' => $id, 'log_id' => (string) Str::uuid(),
        ]);
        if (! $this->lastResult['ok']) {
            return false;
        }
        $this->request->session()->regenerate(true);
        $this->request->session()->put('platform_session_id', $id);
        $this->resolved = false;

        return $this->user() !== null;
    }

    public function logout(): void
    {
        if ($id = $this->request->session()->get('platform_session_id')) {
            $this->platform->logout($id);
        }
        $this->request->session()->invalidate();
        $this->request->session()->regenerateToken();
        $this->user = null;
        $this->resolved = true;
    }

    public function validate(array $credentials = []): bool
    {
        return false;
    }

    public function once(array $credentials = []): bool
    {
        return false;
    }

    public function login(Authenticatable $user, $remember = false): void
    {
        throw new \LogicException('Use two-factor sign-in.');
    }

    public function loginUsingId($id, $remember = false): ?Authenticatable
    {
        return null;
    }

    public function onceUsingId($id): ?Authenticatable
    {
        return null;
    }

    public function viaRemember(): bool
    {
        return false;
    }
}
