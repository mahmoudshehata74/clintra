<?php

namespace App\Http\Controllers;

use App\Support\Platform;
use App\Support\Refusal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

final class ClinicController
{
    public function state(Request $request, Platform $platform, string $org)
    {
        abort_unless(preg_match('/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/D', $org), 404);
        $result = $platform->setOrgDisabled(Auth::guard('platform')->id(), $request->input('otp'), $org,
            $request->input('disabled'), $request->input('reason'));
        if (! $result['ok']) {
            if (($result['all_sessions_ended'] ?? false) || $result['reason'] === 'session_invalid') {
                $request->session()->invalidate();
                $request->session()->regenerateToken();

                return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => Refusal::message($result)]);
            }

            return redirect()->route('filament.admin.pages.clinic', ['org' => $org])->withErrors(['auth' => Refusal::message($result)]);
        }

        return redirect()->route('filament.admin.pages.clinic', ['org' => $org])->with('notice', $request->input('disabled') === '1' ? 'اتوقفت العيادة' : 'اشتغلت العيادة');
    }
}
