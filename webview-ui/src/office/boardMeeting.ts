/**
 * Board meeting: swap each participating VP's seat assignment from their
 * regular desk to a BOARDROOM_SEAT_MARKER seat, flip them to "active" so the
 * FSM walks them to the new seat, then on adjourn restore everyone's
 * original seat.
 *
 * The marker is an "invisible" 1x1 chair furniture item the user places in
 * the office editor to mark each conference seat. Each marker creates one
 * Seat in officeState.seats (keyed by the marker's furniture `uid`).
 */

import { getCharacterIdForVp, getVpIdForCharacter } from './boardroomRoster.js';
import type { OfficeState } from './engine/officeState.js';
import { CharacterState } from './types.js';

const MARKER_TYPE = 'BOARDROOM_SEAT_MARKER';

// Remember each VP's normal seat so we can restore it on adjourn.
const originalSeats = new Map<string, string | null>();

/**
 * Walk all selected backend VPs to BOARDROOM_SEAT_MARKER seats. Reassigns
 * their `seatId` so the FSM pathfinds them to the marker. Returns counts +
 * the meeting center for camera focus.
 */
export function callBoardMeeting(
  officeState: OfficeState,
  vpIds?: string[],
): { sent: number; markers: number; center: { col: number; row: number } | null } {
  // Discover marker furniture and map to seat ids (seat uid === furniture uid
  // for the primary seat of a 1x1 chair, which BOARDROOM_SEAT_MARKER is).
  const markerFurniture = officeState.getLayout().furniture.filter((f) => f.type === MARKER_TYPE);
  if (markerFurniture.length === 0) {
    return { sent: 0, markers: 0, center: null };
  }

  // Build list of marker seats (seatId, col, row) by looking up officeState.seats
  const markerSeats: { seatId: string; col: number; row: number }[] = [];
  for (const m of markerFurniture) {
    const seat = officeState.seats.get(m.uid);
    if (seat) markerSeats.push({ seatId: m.uid, col: seat.seatCol, row: seat.seatRow });
  }
  const center =
    markerSeats.length === 0
      ? null
      : {
          col: Math.round(markerSeats.reduce((s, m) => s + m.col, 0) / markerSeats.length),
          row: Math.round(markerSeats.reduce((s, m) => s + m.row, 0) / markerSeats.length),
        };

  // Determine which VPs go
  const ids: string[] =
    vpIds && vpIds.length > 0
      ? vpIds
      : Array.from(officeState.characters.keys())
          .map((cid) => getVpIdForCharacter(cid))
          .filter((v): v is string => !!v);

  // Track which marker seats are still free as we assign
  const remaining = [...markerSeats];

  let sent = 0;
  for (const vpId of ids) {
    if (remaining.length === 0) break;
    const charId = getCharacterIdForVp(vpId);
    if (charId === undefined) continue;
    const ch = officeState.characters.get(charId);
    if (!ch) continue;

    // Pick the closest REACHABLE marker. Walls and other chair seats in
    // between can make a marker unreachable; if we just assigned blindly the
    // character would sit in place (looking like they're in the wrong room).
    const sortedByDist = remaining
      .map((m, idx) => ({
        m,
        idx,
        d: Math.abs(m.col - ch.tileCol) + Math.abs(m.row - ch.tileRow),
      }))
      .sort((a, b) => a.d - b.d);

    let chosen: { idx: number; m: (typeof remaining)[number] } | null = null;
    for (const cand of sortedByDist) {
      if (officeState.canCharacterReachTile(charId, cand.m.col, cand.m.row)) {
        chosen = cand;
        break;
      }
    }
    if (!chosen) {
      // No marker is reachable from this character's position. Skip — don't
      // pretend they're seated.

      console.warn(`[boardroom] ${vpId}: no reachable boardroom marker; staying put`);
      continue;
    }

    // Save original seat once (idempotent across re-calls during the same meeting)
    if (!originalSeats.has(vpId)) {
      originalSeats.set(vpId, ch.seatId);
    }

    // Free their current seat so a wandering VP can sit there
    if (ch.seatId && officeState.seats.has(ch.seatId)) {
      const oldSeat = officeState.seats.get(ch.seatId)!;
      oldSeat.assigned = false;
    }

    // Claim the marker seat
    const markerSeatObj = officeState.seats.get(chosen.m.seatId);
    if (markerSeatObj) {
      markerSeatObj.assigned = true;
      ch.seatId = chosen.m.seatId;
    }
    remaining.splice(chosen.idx, 1);

    // Activate + clear current path so they head to the new seat
    ch.isActive = true;
    ch.path = [];
    ch.moveProgress = 0;
    if (ch.state === CharacterState.WALK) {
      ch.state = CharacterState.IDLE;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
    sent++;
  }
  return { sent, markers: markerSeats.length, center };
}

/**
 * Adjourn: restore each VP's original seat, deactivate them.
 */
export function adjournBoardMeeting(officeState: OfficeState): void {
  for (const [vpId, originalSeatId] of originalSeats.entries()) {
    const charId = getCharacterIdForVp(vpId);
    if (charId === undefined) continue;
    const ch = officeState.characters.get(charId);
    if (!ch) continue;

    // Free the marker seat
    if (ch.seatId && officeState.seats.has(ch.seatId)) {
      officeState.seats.get(ch.seatId)!.assigned = false;
    }

    // Reclaim original seat (if still free)
    if (originalSeatId && officeState.seats.has(originalSeatId)) {
      const orig = officeState.seats.get(originalSeatId)!;
      if (!orig.assigned) {
        orig.assigned = true;
        ch.seatId = originalSeatId;
      } else {
        ch.seatId = null;
      }
    } else {
      ch.seatId = null;
    }

    ch.isActive = false;
    ch.path = [];
    ch.moveProgress = 0;
  }
  originalSeats.clear();
}
