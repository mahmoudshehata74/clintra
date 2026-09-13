<?php

namespace App\Support\Sync;

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
 * patient_id). It is deliberately additive: GET /api/sync/pull's own SQL,
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

    /** Stage order: day_state and visits have a principled date to window by; patients are windowed transitively, via the visits that reference them. */
    private const STAGE_DAY_STATE = 0;

    private const STAGE_VISITS = 1;

    private const STAGE_PATIENTS = 2;

    private const STAGE_DONE = 3;

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
            default => throw new InvalidArgumentException("unknown bootstrap stage: {$stage}"),
        };
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

        if (! preg_match('/^([0-3]):([0-9a-fA-F-]*)$/', $cursor, $matches)) {
            throw new InvalidArgumentException("malformed bootstrap cursor: {$cursor}");
        }

        return [(int) $matches[1], $matches[2] === '' ? null : $matches[2]];
    }

    private function encodeCursor(int $stage, ?string $afterId): string
    {
        return "{$stage}:{$afterId}";
    }
}
