<?php

namespace App\Http\Controllers;

use App\Support\Platform;
use App\Support\Refusal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

final class SupportEntryController
{
    public static function normalizeCode(mixed $input): string
    {
        if (! is_string($input)) return '';
        $significant = substr(preg_replace('/[^A-Z0-9]/', '', preg_replace('/^CLT-?/', '', strtoupper($input))), 0, 16);
        if (strlen($significant) !== 16) return '';
        return 'CLT-'.implode('-', str_split($significant, 4));
    }

    public function open(Request $request, Platform $platform)
    {
        $session = Auth::guard('platform')->id();
        $code = self::normalizeCode($request->input('code'));
        $exchange = \App\Support\Code::generate();
        $result = $platform->openSupport($session, $request->input('otp'), hash('sha256', $code),
            (string) Str::uuid(), hash('sha256', $exchange));
        if (! $result['ok']) {
            if (($result['all_sessions_ended'] ?? false) || $result['reason'] === 'session_invalid') {
                $request->session()->invalidate();
                $request->session()->regenerateToken();
                return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => Refusal::supportMessage($result)]);
            }
            return redirect()->route('filament.admin.pages.support-entry')->withErrors(['auth' => Refusal::supportMessage($result)]);
        }
        $base = rtrim(config('app.clinic_app_url'), '/');
        $url = $base.'/#support='.rawurlencode($exchange);
        return response()->view('pages.support-link', ['url' => $url]);
    }
}
