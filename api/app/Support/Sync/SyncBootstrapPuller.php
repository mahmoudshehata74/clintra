<?php

namespace App\Support\Sync;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * GET /api/sync/bootstrap — the fix for a real finding from the manual dry
 * run (docs/dry-run.md's scenario 17): GET /api/sync/pull pages strictly in
 * ascending sync_ledger.seq order, oldest first, so a replacement device's
 * very first sync used to walk the org's *entire* history before it ever
 * reached today's schedule. This class exists to hand a fresh device
 * something useful before that backfill finishes, without touching the
 * pull endpoint's cursor semantics at all.
 *
 * Design (see docs/sync-plan.md's Q9 addendum for the full write-up of the
 * options weighed): a wholly separate, non-ledger, non-cursor endpoint that
 * returns the *current state* of the brief's own 60-day window
 * (SyncWindow::DAYS) directly from the entity tables — day_state and
 * visits, the two tables with a principled date, plus the patients those
 * windowed visits reference (so a name renders, not just a bare
 * patient_id), the prescriptions of those visits with their items (a
 * prescription belongs to exactly one visit, so it is windowed through it),
 * every one of the org's practitioners, the messages attempted inside the
 * window, every one of the org's message template overrides, and the care
 * plans of the windowed patients (plus every active plan) with their
 * sessions.
 * It is deliberately additive: GET /api/sync/pull's own SQL,
 * cursor format, and monotonic seq guarantee are completely untouched by
 * this class, so a device that has already synced before (pull_cursor is
 * non-null) never calls this endpoint at all and is not affected by its
 * existence in any way — see web/src/sync/engine.ts's runPullCycle for the
 * client-side gate.
 *
 * Completeness is guaranteed by a different mechanism than pagination
 * within this endpoint: once a device has drained this endpoint, it still
 * runs the ordinary GET /api/sync/pull loop from cursor 0, exactly as
 * before, which walks the *entire* ledger unchanged — re-delivering
 * whatever this endpoint already sent, harmlessly (an entity-table `put`
 * is idempotent), and eventually reaching every row this endpoint's window
 * excluded (older visits, invoices, payments, and every non-dated table).
 * The cost of that redundancy, and the entities this endpoint does not
 * cover, are both named in docs/sync-plan.md rather than hidden.
 */
class SyncBootstrapPuller
{
    private const PAGE_SIZE = 200;

    /**
     * Stage order: day_state and visits have a principled date to window by;
     * patients and prescriptions are windowed transitively, via the visits
     * that reference them, and prescription_items via those prescriptions.
     * practitioners are the org's few prescribers, not windowed at all:
     * every one, so a fresh device prints the current name, title and
     * syndicate number. messages are windowed by their own attempted_at, and
     * message_templates are the org's few overrides, not windowed.
     * care_plans have no principled date of their own (a plan can run for
     * months): a plan comes when its patient has a visit in the window — the
     * same patients stage 2 returns — or when it is still active, so a
     * stalled patient's plan reaches a fresh device too; care_plan_items
     * come with their plans. Each stage was appended after the existing
     * ones, so a cursor minted before it existed keeps its meaning.
     */
    private const STAGE_DAY_STATE = 0;

    private const STAGE_VISITS = 1;

    private const STAGE_PATIENTS = 2;

    private const STAGE_PRESCRIPTIONS = 3;

    private const STAGE_PRESCRIPTION_ITEMS = 4;

    private const STAGE_PRACTITIONERS = 5;

    private const STAGE_MESSAGES = 6;

    private const STAGE_MESSAGE_TEMPLATES = 7;

    private const STAGE_CARE_PLANS = 8;

    private const STAGE_CARE_PLAN_ITEMS = 9;

    private const STAGE_DONE = 10;

    /**
     * @return array{cursor: string, has_more: bool, rows: list<array{entity: string, entity_id: string, rev: int, payload: array<string, mixed>}>}
     */
    public function pull(?string $cursor): array
    {
        [$stage, $afterId] = $this->parseCursor($cursor);

        $from = now()->subDays(SyncWindow::DAYS)->toDateString();
        $to = now()->addDays(SyncWindow::DAYS)->toDateString();

        while ($stage < self::STAGE_DONE) {
            $page = $this->queryStage($stage, $afterId, $from, $to);

            if ($page->isEmpty()) {
                $stage++;
                $afterId = null;

                continue;
            }

            $hasMoreInStage = $page->count() > self::PAGE_SIZE;
            $rows = $hasMoreInStage ? $page->take(self::PAGE_SIZE) : $page;
            $lastId = $rows->last()->id;

            $newCursor = $hasMoreInStage
                ? $this->encodeCursor($stage, $lastId)
                : $this->encodeCursor($stage + 1, null);

            return [
                'cursor' => $newCursor,
                'has_more' => $hasMoreInStage || $stage + 1 < self::STAGE_DONE,
                'rows' => $rows->map(fn ($row) => $this->toRow($stage, $row))->values()->all(),
            ];
        }

        return ['cursor' => $this->encodeCursor(self::STAGE_DONE, null), 'has_more' => false, 'rows' => []];
    }

    private function queryStage(int $stage, ?string $afterId, string $from, string $to)
    {
        return match ($stage) {
            self::STAGE_DAY_STATE => DB::table('day_state')
                ->whereBetween('date', [$from, $to])
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_VISITS => DB::table('visits')
                ->whereBetween('visit_date', [$from, $to])
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_PATIENTS => DB::table('patients')
                ->whereIn('id', function ($q) use ($from, $to) {
                    $q->select('patient_id')->from('visits')
                        ->whereBetween('visit_date', [$from, $to])
                        ->whereNotNull('patient_id');
                })
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_PRESCRIPTIONS => DB::table('prescriptions')
                ->whereIn('visit_id', function ($q) use ($from, $to) {
                    $q->select('id')->from('visits')->whereBetween('visit_date', [$from, $to]);
                })
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_PRESCRIPTION_ITEMS => DB::table('prescription_items')
                ->whereIn('prescription_id', function ($q) use ($from, $to) {
                    $q->select('prescriptions.id')->from('prescriptions')
                        ->join('visits', 'visits.id', '=', 'prescriptions.visit_id')
                        ->whereBetween('visits.visit_date', [$from, $to]);
                })
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_PRACTITIONERS => DB::table('practitioners')
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            // attempted_at is an instant: the window is the same calendar
            // days, from the start of $from to the end of $to.
            self::STAGE_MESSAGES => DB::table('messages')
                ->where('attempted_at', '>=', now()->subDays(SyncWindow::DAYS)->startOfDay()->toIso8601String())
                ->where('attempted_at', '<', now()->addDays(SyncWindow::DAYS + 1)->startOfDay()->toIso8601String())
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_MESSAGE_TEMPLATES => DB::table('message_templates')
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_CARE_PLANS => $this->carePlansQuery($from, $to)
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            self::STAGE_CARE_PLAN_ITEMS => DB::table('care_plan_items')
                ->whereIn('care_plan_id', fn ($q) => $this->carePlansQuery($from, $to, $q)->select('id'))
                ->when($afterId !== null, fn ($q) => $q->where('id', '>', $afterId))
                ->orderBy('id')
                ->limit(self::PAGE_SIZE + 1)
                ->get(),
            default => throw new InvalidArgumentException("unknown bootstrap stage: {$stage}"),
        };
    }

    /**
     * The care plans a fresh device gets: those of a patient with a visit in
     * the window, and every active one. Built on $query when given (a
     * subquery's builder), otherwise on a new query.
     */
    private function carePlansQuery(string $from, string $to, ?Builder $query = null): Builder
    {
        return ($query ?? DB::query())->from('care_plans')
            ->where(function ($q) use ($from, $to) {
                $q->where('status', 'active')
                    ->orWhereIn('patient_id', function ($visits) use ($from, $to) {
                        $visits->select('patient_id')->from('visits')
                            ->whereBetween('visit_date', [$from, $to])
                            ->whereNotNull('patient_id');
                    });
            });
    }

    /**
     * @return array{entity: string, entity_id: string, rev: int, payload: array<string, mixed>}
     */
    private function toRow(int $stage, object $row): array
    {
        $entity = match ($stage) {
            self::STAGE_DAY_STATE => 'day_state',
            self::STAGE_VISITS => 'visits',
            self::STAGE_PATIENTS => 'patients',
            self::STAGE_PRESCRIPTIONS => 'prescriptions',
            self::STAGE_PRESCRIPTION_ITEMS => 'prescription_items',
            self::STAGE_PRACTITIONERS => 'practitioners',
            self::STAGE_MESSAGES => 'messages',
            self::STAGE_MESSAGE_TEMPLATES => 'message_templates',
            self::STAGE_CARE_PLANS => 'care_plans',
            self::STAGE_CARE_PLAN_ITEMS => 'care_plan_items',
        };

        return [
            'entity' => $entity,
            'entity_id' => $row->id,
            'rev' => (int) $row->rev,
            'payload' => (array) $row,
        ];
    }

    /**
     * @return array{0: int, 1: ?string}
     */
    private function parseCursor(?string $cursor): array
    {
        if ($cursor === null) {
            return [self::STAGE_DAY_STATE, null];
        }

        if (! preg_match('/^([0-9]|10):([0-9a-fA-F-]*)$/', $cursor, $matches)) {
            throw new InvalidArgumentException("malformed bootstrap cursor: {$cursor}");
        }

        return [(int) $matches[1], $matches[2] === '' ? null : $matches[2]];
    }

    private function encodeCursor(int $stage, ?string $afterId): string
    {
        return "{$stage}:{$afterId}";
    }
}
