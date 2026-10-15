<?php

namespace App\Http\Controllers;

use App\Http\Requests\AddStaffMemberRequest;
use App\Support\EgyptianPhone;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;
use Symfony\Component\HttpFoundation\Response;

/**
 * POST /api/staff — adds a staff member in one step, online only: finds the
 * user by phone or creates it, then creates the membership, its location and
 * practitioner links and the audit row, all inside add_staff_member(jsonb)
 * (2026_09_12_000032_add_staff_member_function.php; api/docs/rls.md's
 * "Adding staff"). Runs behind the `membership` middleware, so the whole
 * request — the function and the ledger rows below — is one transaction.
 *
 * The function decides who may add staff (an active owner of the caller's
 * organization) and refuses everything else with one generic error, which
 * this endpoint renders exactly like a route that does not exist: 404, never
 * 403, so a refusal says nothing about what exists.
 *
 * The created rows are written to sync_ledger here, on the ordinary
 * RLS-bound connection, so the organization's other devices pull them like
 * any pushed write; the response carries the same rows for the calling
 * device to store straight away, so the new member can sign in on it at
 * once.
 */
class StaffController extends Controller
{
    public function store(AddStaffMemberRequest $request): JsonResponse
    {
        $deviceId = $request->attributes->get('device_id');

        if ($deviceId === null) {
            // Same rule as the push endpoint: the local-only
            // X-Membership-Id bridge has no device to record the rows
            // against.
            return response()->json([
                'error' => 'unauthenticated',
                'message' => 'يجب تسجيل الدخول',
            ], Response::HTTP_UNAUTHORIZED);
        }

        try {
            $phone = EgyptianPhone::normalize($request->string('phone')->toString());
        } catch (InvalidArgumentException) {
            throw ValidationException::withMessages([
                'phone' => 'رقم الهاتف غير صالح',
            ]);
        }

        $validated = $request->validated();
        $payload = [
            'membership_id' => $validated['membership_id'],
            'user_id' => $validated['user_id'],
            'display_name' => $validated['display_name'],
            'phone' => $phone,
            'role' => $validated['role'],
            'location_scope' => $validated['location_scope'],
            'practitioner_scope' => $validated['practitioner_scope'],
            'practitioner_id' => $validated['practitioner_id'],
            'pin_hash' => $validated['pin_hash'],
            'pin_salt' => $validated['pin_salt'],
            'locations' => array_map(
                fn (array $link) => ['id' => $link['id'], 'location_id' => $link['location_id']],
                $validated['locations'],
            ),
            'practitioners' => array_map(
                fn (array $link) => ['id' => $link['id'], 'practitioner_id' => $link['practitioner_id']],
                $validated['practitioners'],
            ),
            'audit_id' => (string) Str::uuid(),
        ];

        try {
            // A savepoint, so a refusal leaves the request's own
            // transaction usable rather than aborted.
            $row = DB::transaction(fn () => DB::selectOne(
                'select add_staff_member(?::jsonb) as result',
                [json_encode($payload, JSON_THROW_ON_ERROR)],
            ));
        } catch (QueryException $e) {
            return match ($e->getCode()) {
                'P0001' => $this->notFound(),
                '23505' => $this->alreadyMember(),
                '22023' => $this->invalidPayload(),
                default => throw $e,
            };
        }

        $result = json_decode($row->result, associative: true, flags: JSON_THROW_ON_ERROR);
        $this->recordInLedger($result, $deviceId);

        return response()->json($result, Response::HTTP_CREATED);
    }

    /**
     * One ledger row per created row, attributed like a pushed op: the
     * token's membership and device, on the caller's organization (the
     * ledger's own policy checks org_id = current_org()).
     *
     * @param  array{membership: array<string, mixed>, membership_locations: list<array<string, mixed>>, membership_practitioners: list<array<string, mixed>>}  $result
     */
    private function recordInLedger(array $result, string $deviceId): void
    {
        $session = DB::selectOne('select current_org() as org_id, current_membership() as membership_id');
        $now = now()->toIso8601String();

        $rows = [['memberships', $result['membership']]];
        foreach ($result['membership_locations'] as $link) {
            $rows[] = ['membership_locations', $link];
        }
        foreach ($result['membership_practitioners'] as $link) {
            $rows[] = ['membership_practitioners', $link];
        }

        foreach ($rows as [$entity, $created]) {
            DB::table('sync_ledger')->insert([
                'op_id' => (string) Str::uuid(),
                'org_id' => $session->org_id,
                'entity' => $entity,
                'entity_id' => $created['id'],
                'rev' => $created['rev'],
                'actor_membership_id' => $session->membership_id,
                'device_id' => $deviceId,
                'applied_at' => $now,
                'client_created_at' => $now,
            ]);
        }
    }

    /** The exact body of a route that does not exist (bootstrap/app.php). */
    private function notFound(): JsonResponse
    {
        return response()->json([
            'error' => 'not_found',
            'message' => 'لم يتم العثور على المورد',
        ], Response::HTTP_NOT_FOUND);
    }

    private function alreadyMember(): JsonResponse
    {
        return response()->json([
            'error' => 'already_member',
            'message' => 'الرقم ده مسجّل لموظف في العيادة',
        ], Response::HTTP_CONFLICT);
    }

    private function invalidPayload(): JsonResponse
    {
        return response()->json([
            'error' => 'validation_failed',
            'message' => 'بيانات غير صالحة',
        ], Response::HTTP_UNPROCESSABLE_ENTITY);
    }
}
