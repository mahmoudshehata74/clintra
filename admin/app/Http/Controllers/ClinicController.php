<?php

namespace App\Http\Controllers;

use App\Support\Code;
use App\Support\Platform;
use App\Support\Refusal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;

final class ClinicController
{
    private function clinicUrl(string $org): string
    {
        return route('filament.admin.pages.clinic', ['org' => $org]);
    }

    private function refuse(Request $request, string $org, array $result)
    {
        if (($result['all_sessions_ended'] ?? false) || $result['reason'] === 'session_invalid') {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
            return redirect()->route('filament.admin.auth.login')->withErrors(['auth' => Refusal::message($result)]);
        }
        return redirect($this->clinicUrl($org))->withErrors(['auth' => Refusal::message($result)]);
    }

    public function state(Request $request, Platform $platform, string $org)
    {
        abort_unless(preg_match('/^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/D', $org), 404);
        $result = $platform->setOrgDisabled(Auth::guard('platform')->id(), $request->input('otp'), $org,
            $request->input('disabled'), $request->input('reason'));
        if (! $result['ok']) return $this->refuse($request, $org, $result);

        return redirect()->route('filament.admin.pages.clinic', ['org' => $org])->with('notice', $request->input('disabled') === '1' ? 'اتوقفت العيادة' : 'اشتغلت العيادة');
    }

    public function revoke(Request $request, Platform $platform, string $org, string $device)
    {
        abort_unless(Str::isUuid($org) && Str::isUuid($device), 404);
        $result = $platform->revokeDevice(Auth::guard('platform')->id(), $request->input('otp'), $device);
        if (! $result['ok']) return $this->refuse($request, $org, $result);
        return redirect($this->clinicUrl($org))->with('notice', 'اتلغى الجهاز');
    }

    public function requestCode(Request $request, Platform $platform, string $org)
    {
        abort_unless(Str::isUuid($org), 404);
        $session = Auth::guard('platform')->id();
        $approvals = $platform->orgApprovals($session, $org);
        if (! $approvals['ok']) return $this->refuse($request, $org, $approvals);
        $single = $approvals['active_admin_count'] < 2;
        $code = $single ? Code::generate() : null;
        $payload = [
            'approval_id' => (string) Str::uuid(), 'org_id' => $org,
            'location_id' => $request->input('location_id'), 'purpose' => $request->input('purpose'),
        ];
        if ($code !== null) $payload['code_hash'] = Code::hash($code);
        $result = $platform->requestCode($session, $request->input('otp'), $payload);
        if (! $result['ok']) return $this->refuse($request, $org, $result);
        if ($result['pending']) return redirect($this->clinicUrl($org))->with('notice', 'طلب الكود مستني موافقة مسؤول تاني');
        return response()->view('pages.minted-code', ['org' => $org, 'code' => $code]);
    }

    public function approveCode(Request $request, Platform $platform, string $org, string $approval)
    {
        abort_unless(Str::isUuid($org) && Str::isUuid($approval), 404);
        $code = Code::generate();
        $result = $platform->approveCode(Auth::guard('platform')->id(), $request->input('otp'), $approval, Code::hash($code));
        if (! $result['ok']) return $this->refuse($request, $org, $result);
        return response()->view('pages.minted-code', ['org' => $org, 'code' => $code]);
    }
}
