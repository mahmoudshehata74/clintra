import { Role } from "./role";
import { VisitStatus } from "./visitStatus";

/**
 * Queue reordering (screen 3's "إعادة ترتيب"): the waiting visits — the
 * arrived ones — of one doctor's queue day move up or down, one place at a
 * time. A reorder only ever permutes the waiting visits' own positions:
 * every booked, in-room, completed or cancelled visit keeps the position it
 * has, and the waiting visits end up holding exactly the positions they
 * held between them before.
 */

/** Who may reorder: the owner and the assistant. */
export function canReorderQueue(role: Role | undefined): boolean {
  return role === Role.Owner || role === Role.Assistant;
}

export interface QueuedVisit {
  id: string;
  status: string;
  position: number;
}

/** One visit's move: from the position it holds to the one it takes. */
export interface QueueMove {
  visitId: string;
  from: number;
  to: number;
}

/** The waiting (arrived) visits, in queue order. */
export function waitingVisits<T extends QueuedVisit>(visits: readonly T[]): T[] {
  return visits.filter((visit) => visit.status === VisitStatus.Arrived).sort((a, b) => a.position - b.position);
}

/**
 * The moves that put the waiting visits in `orderedIds`' order: the
 * waiting visits' positions, ascending, handed out in that order. Null
 * unless `orderedIds` names every waiting visit exactly once and nothing
 * else. Only visits whose position changes are returned.
 */
export function permutationMoves(visits: readonly QueuedVisit[], orderedIds: readonly string[]): QueueMove[] | null {
  const waiting = waitingVisits(visits);
  const waitingIds = new Set(waiting.map((visit) => visit.id));
  const isPermutation =
    orderedIds.length === waiting.length &&
    new Set(orderedIds).size === orderedIds.length &&
    orderedIds.every((visitId) => waitingIds.has(visitId));
  if (!isPermutation) {
    return null;
  }
  const positions = waiting.map((visit) => visit.position);
  const byId = new Map(waiting.map((visit) => [visit.id, visit]));
  return orderedIds
    .map((visitId, index) => ({ visitId, from: byId.get(visitId)!.position, to: positions[index] }))
    .filter((move) => move.from !== move.to);
}

/**
 * The moves for one waiting visit moving one place up (earlier) or down
 * (later) among the waiting visits: it trades positions with its neighbour.
 * Null when it is not waiting or is already first (up) or last (down).
 */
export function moveOnePlace(visits: readonly QueuedVisit[], visitId: string, direction: "up" | "down"): QueueMove[] | null {
  const order = waitingVisits(visits).map((visit) => visit.id);
  const index = order.indexOf(visitId);
  const other = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || other < 0 || other >= order.length) {
    return null;
  }
  [order[index], order[other]] = [order[other], order[index]];
  return permutationMoves(visits, order);
}

/** One write of a reorder, in the order they must be made: a visit to a position. */
export interface QueueWrite {
  visitId: string;
  position: number;
}

/**
 * Where a cycle's first visit waits while the others move: the negative of
 * the position it leaves. No visit ever holds a position below 1, and the
 * position it leaves is its own, so no other visit of the day — on this
 * device or the server — is parked there at the same time.
 */
export function parkingPosition(from: number): number {
  return -from;
}

/**
 * The writes that carry out `moves` one at a time without two visits ever
 * holding one position (the unique [practitioner, day, position] key, on
 * the device and on the server, where each write is its own statement).
 * Each cycle of the permutation parks its first visit, moves every other
 * visit of the cycle into the position the one before it left free, then
 * brings the parked visit to its place.
 */
export function orderedWrites(moves: readonly QueueMove[]): QueueWrite[] {
  const done = new Set<string>();
  const writes: QueueWrite[] = [];
  for (const head of [...moves].sort((a, b) => a.from - b.from)) {
    if (done.has(head.visitId)) {
      continue;
    }
    writes.push({ visitId: head.visitId, position: parkingPosition(head.from) });
    done.add(head.visitId);
    // The position the head left is free: whoever moves into it goes next.
    let free = head.from;
    let next = moves.find((move) => move.to === free && !done.has(move.visitId));
    while (next) {
      writes.push({ visitId: next.visitId, position: next.to });
      done.add(next.visitId);
      free = next.from;
      next = moves.find((move) => move.to === free && !done.has(move.visitId));
    }
    writes.push({ visitId: head.visitId, position: head.to });
  }
  return writes;
}
