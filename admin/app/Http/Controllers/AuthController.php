<?php

namespace App\Http\Controllers;

use App\Support\Platform;
use App\Support\Refusal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

final class AuthController
{
    public function signIn(Request $request, Platform $platform)
    {
        $validator = Validator::make($request->only('email', 'password', 'otp'), [
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => ['required', 'string', function ($attribute, $value, $fail) {
                if (strlen($value) > 72) {
                    $fail('راجع البيانات وحاول تاني');
                }
            }],
            'otp' => ['required', 'string', 'max:128'],
        ]);
        if ($validator->fails()) {
            $platform->refusal(null, 'admin.login', 'invalid_payload');

            return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => 'راجع البيانات وحاول تاني']);
        }
        $guard = Auth::guard('platform');
        if (! $guard->attempt($validator->validated())) {
            if (($guard->lastResult['reason'] ?? '') === 'invalid_payload') {
                $platform->refusal(null, 'admin.login', 'invalid_payload');
            }

            return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => Refusal::message($guard->lastResult)]);
        }

        return redirect()->route($guard->user()->must_change_password ? 'filament.admin.pages.change-password' : 'filament.admin.pages.admin-log');
    }

    public function signOut(Request $request)
    {
        Auth::guard('platform')->logout();

        return redirect()->route('filament.admin.auth.login');
    }

    public function password(Request $request, Platform $platform)
    {
        $guard = Auth::guard('platform');
        if (! $guard->check()) {
            return redirect()->route('filament.admin.auth.login');
        }
        $validator = Validator::make($request->only('current_password', 'password', 'password_confirmation', 'otp'), [
            'current_password' => ['required', 'string', function ($a, $v, $fail) {
                if (strlen($v) > 72) {
                    $fail('راجع البيانات وحاول تاني');
                }
            }],
            'password' => ['required', 'string', 'confirmed', function ($a, $v, $fail) {
                if (strlen($v) < 12 || strlen($v) > 72) {
                    $fail('كلمة السر لازم تكون من 12 لحد 72 بايت');
                }
            }],
            'otp' => ['required', 'string', 'max:128'],
        ]);
        $session = $request->session()->get('platform_session_id');
        if ($validator->fails()) {
            $platform->refusal($session, 'admin.password_change', 'invalid_payload');

            return redirect()->route('filament.admin.pages.change-password')->withErrors(['auth' => 'راجع البيانات وحاول تاني']);
        }
        $data = $validator->validated();
        unset($data['password_confirmation']);
        $result = $platform->changePassword($data + ['session_id' => $session, 'log_id' => (string) Str::uuid()]);
        if (! $result['ok']) {
            if ($result['reason'] === 'invalid_payload') {
                $platform->refusal($session, 'admin.password_change', 'invalid_payload');
            }
            if (($result['all_sessions_ended'] ?? false) || $result['reason'] === 'session_invalid') {
                $request->session()->invalidate();
                $request->session()->regenerateToken();

                return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => Refusal::message($result)]);
            }

            return redirect()->route('filament.admin.pages.change-password')->withErrors(['auth' => Refusal::message($result)]);
        }
        $request->session()->regenerate(true);

        return redirect()->route('filament.admin.pages.admin-log')->with('notice', 'اتغيّرت كلمة السر');
    }
}
