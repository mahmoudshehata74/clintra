<?php

namespace App\Http\Controllers;

use App\Support\Identity\AuthCall;
use App\Support\Identity\AuthCallFailed;
use App\Support\Identity\IdentityStrings;
use App\Support\Identity\StepUp;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class IdentityRolloutController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        if ($refusal = $this->ownerOnly($request)) {
            return $refusal;
        }

        return response()->json($this->withDeviceLabels(AuthCall::run('auth_identity_rollout', ['action' => 'status'])));
    }

    public function enable(Request $request): JsonResponse
    {
        if ($refusal = $this->ownerOnly($request)) {
            return $refusal;
        }
        $input = Validator::make($request->all(), ['password' => ['required', 'string', 'max:1024']]);
        if ($input->fails()) {
            return response()->json(['error' => 'invalid_password', 'message' => IdentityStrings::get('rolloutPasswordRequired')], 422);
        }
        $deviceId = $request->attributes->get('device_id');
        $person = $request->attributes->get('person');
        $attempt = StepUp::attempt($deviceId, $person['membership_id'], $input->validated()['password']);
        if ($attempt instanceof JsonResponse) {
            return $attempt;
        }

        try {
            $status = AuthCall::run('auth_identity_rollout', ['action' => 'manual', 'device_id' => $deviceId, 'attempt_id' => $attempt]);
        } catch (AuthCallFailed $e) {
            if ($e->sqlState !== 'P0001') {
                throw $e;
            }

            return $this->notAllowed();
        }
        $status = $this->withDeviceLabels($status);
        if ($status['identity_enforced_at'] === null) {
            return response()->json([
                ...$status,
                'error' => 'rollout_not_ready',
                'message' => implode(' ', array_map(IdentityStrings::get(...), $status['blockers'])),
            ], 409);
        }

        return response()->json($status);
    }

    private function ownerOnly(Request $request): ?JsonResponse
    {
        return $request->attributes->get('person')['role'] === 'owner' ? null : $this->notAllowed();
    }

    private function withDeviceLabels(array $status): array
    {
        $ready = array_column($status['devices'], 'bound', 'id');
        $status['devices'] = DB::table('device')->whereIn('id', array_keys($ready))
            ->orderBy('location_id')->orderBy('series')->orderBy('id')
            ->get(['id', 'location_id', 'series'])->map(fn ($device) => [
                'id' => $device->id,
                'location_id' => $device->location_id,
                'series' => (int) $device->series,
                'bound' => $ready[$device->id],
            ])->all();

        return $status;
    }

    private function notAllowed(): JsonResponse
    {
        return response()->json(['error' => 'not_found', 'message' => IdentityStrings::get('notFound')], 404);
    }
}
