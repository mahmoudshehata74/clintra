import { describe, expect, it } from "vitest";
import { canReorderQueue, moveOnePlace, orderedWrites, permutationMoves, waitingVisits, type QueueMove, type QueuedVisit, type QueueWrite } from "./queueReorder";
import { Role } from "./role";
import { VisitStatus } from "./visitStatus";

const day: QueuedVisit[] = [
  { id: "done", status: VisitStatus.Completed, position: 1 },
  { id: "room", status: VisitStatus.InRoom, position: 2 },
  { id: "a", status: VisitStatus.Arrived, position: 3 },
  { id: "booked", status: VisitStatus.Booked, position: 4 },
  { id: "b", status: VisitStatus.Arrived, position: 5 },
  { id: "cancelled", status: VisitStatus.Cancelled, position: 6 },
  { id: "c", status: VisitStatus.Arrived, position: 7 },
];

/** Applies writes one at a time, failing if two visits ever share a position. */
function replay(visits: readonly QueuedVisit[], writes: readonly QueueWrite[]): Map<string, number> {
  const positions = new Map(visits.map((visit) => [visit.id, visit.position]));
  for (const write of writes) {
    for (const [visitId, position] of positions) {
      if (visitId !== write.visitId && position === write.position) {
        throw new Error(`${write.visitId} -> ${write.position} collides with ${visitId}`);
      }
    }
    positions.set(write.visitId, write.position);
  }
  return positions;
}

describe("canReorderQueue", () => {
  it("lets the owner and the assistant reorder, and nobody else", () => {
    expect(canReorderQueue(Role.Owner)).toBe(true);
    expect(canReorderQueue(Role.Assistant)).toBe(true);
    expect(canReorderQueue(Role.Practitioner)).toBe(false);
    expect(canReorderQueue(Role.Manager)).toBe(false);
    expect(canReorderQueue(undefined)).toBe(false);
  });
});

describe("waitingVisits", () => {
  it("is the arrived visits in position order", () => {
    expect(waitingVisits(day).map((visit) => visit.id)).toEqual(["a", "b", "c"]);
  });
});

describe("permutationMoves", () => {
  it("hands the waiting visits' own positions out in the new order, moving nobody else", () => {
    const moves = permutationMoves(day, ["c", "a", "b"])!;
    expect(moves).toEqual([
      { visitId: "c", from: 7, to: 3 },
      { visitId: "a", from: 3, to: 5 },
      { visitId: "b", from: 5, to: 7 },
    ]);
    const after = replay(day, orderedWrites(moves));
    expect(after.get("done")).toBe(1);
    expect(after.get("room")).toBe(2);
    expect(after.get("booked")).toBe(4);
    expect(after.get("cancelled")).toBe(6);
    expect(["c", "a", "b"].map((visitId) => after.get(visitId))).toEqual([3, 5, 7]);
  });

  it("returns no move for the order the queue already has", () => {
    expect(permutationMoves(day, ["a", "b", "c"])).toEqual([]);
  });

  it.each([[["a", "b"]], [["a", "b", "c", "booked"]], [["a", "a", "c"]], [["a", "b", "room"]]])(
    "refuses %j: not exactly the waiting visits",
    (order) => {
      expect(permutationMoves(day, order)).toBeNull();
    },
  );
});

describe("moveOnePlace", () => {
  it("trades positions with the neighbouring waiting visit, skipping everyone else", () => {
    expect(moveOnePlace(day, "b", "up")).toEqual([
      { visitId: "b", from: 5, to: 3 },
      { visitId: "a", from: 3, to: 5 },
    ]);
    expect(moveOnePlace(day, "b", "down")).toEqual([
      { visitId: "c", from: 7, to: 5 },
      { visitId: "b", from: 5, to: 7 },
    ]);
  });

  it("refuses the first moving up, the last moving down, and a visit that is not waiting", () => {
    expect(moveOnePlace(day, "a", "up")).toBeNull();
    expect(moveOnePlace(day, "c", "down")).toBeNull();
    expect(moveOnePlace(day, "booked", "up")).toBeNull();
    expect(moveOnePlace(day, "room", "down")).toBeNull();
  });
});

describe("orderedWrites", () => {
  it("parks a swap's first visit below zero, then moves the other into its place", () => {
    const moves: QueueMove[] = [
      { visitId: "b", from: 5, to: 3 },
      { visitId: "a", from: 3, to: 5 },
    ];
    expect(orderedWrites(moves)).toEqual([
      { visitId: "a", position: -3 },
      { visitId: "b", position: 3 },
      { visitId: "a", position: 5 },
    ]);
  });

  it("carries out any permutation without two visits ever sharing a position", () => {
    const visits: QueuedVisit[] = [1, 2, 3, 4, 5, 6].map((position) => ({ id: `v${position}`, status: VisitStatus.Arrived, position }));
    // Two cycles (v1→v3→v5→v1 and v2↔v6); v4 stays.
    const order = ["v5", "v6", "v1", "v4", "v3", "v2"];
    const moves = permutationMoves(visits, order)!;
    const writes = orderedWrites(moves);
    const after = replay(visits, writes);
    expect(order.map((visitId) => after.get(visitId))).toEqual([1, 2, 3, 4, 5, 6]);
    // One parking write per cycle.
    expect(writes).toHaveLength(moves.length + 2);
  });

  it("carries out moves over a day with gaps, the visits that stay holding their places", () => {
    const visits: QueuedVisit[] = [1, 2, 4, 5, 7].map((position) => ({ id: `v${position}`, status: VisitStatus.Arrived, position }));
    // v2 to the end; every later visit one place earlier — not a permutation of the positions they hold.
    const moves: QueueMove[] = [
      { visitId: "v4", from: 4, to: 3 },
      { visitId: "v5", from: 5, to: 4 },
      { visitId: "v7", from: 7, to: 6 },
      { visitId: "v2", from: 2, to: 7 },
    ];
    const after = replay(visits, orderedWrites(moves, visits.map((visit) => visit.position)));
    expect(["v1", "v4", "v5", "v7", "v2"].map((visitId) => after.get(visitId))).toEqual([1, 3, 4, 6, 7]);
  });

  it("renumbers a day onto 1..n from any positions, parking only what must wait", () => {
    const visits: QueuedVisit[] = [
      { id: "late", status: VisitStatus.Booked, position: 1 },
      { id: "early", status: VisitStatus.Booked, position: 2 },
      { id: "middle", status: VisitStatus.Booked, position: 5 },
    ];
    const moves: QueueMove[] = [
      { visitId: "early", from: 2, to: 1 },
      { visitId: "middle", from: 5, to: 2 },
      { visitId: "late", from: 1, to: 3 },
    ];
    const writes = orderedWrites(moves, [1, 2, 5]);
    const after = replay(visits, writes);
    expect(["early", "middle", "late"].map((visitId) => after.get(visitId))).toEqual([1, 2, 3]);
    // late goes straight to the free 3, then early and middle follow: nothing waits.
    expect(writes).toHaveLength(3);
  });

  it("refuses a move onto a place a visit that does not move holds", () => {
    expect(() => orderedWrites([{ visitId: "a", from: 1, to: 2 }], [1, 2])).toThrow("queue_position_held");
  });
});
