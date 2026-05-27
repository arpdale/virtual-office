/**
 * Classify each chair-derived seat into one of three roles:
 *
 *   - 'boardroom'  → BOARDROOM_SEAT_MARKER (B chairs). Used during board meetings.
 *   - 'desk'       → SEAT_MARKER (D chairs — explicit desk markers the user
 *                    places at workstations), OR any chair whose facing tile
 *                    contains a desk-category furniture. Used when a VP is
 *                    "working" (responding to chat).
 *   - 'lounge'     → any other chair (couches, kitchen chairs, etc. — S chairs).
 *                    Used for ambient wandering / hangouts.
 *
 * Classification is derived at runtime from layout state — no manual tagging.
 */

import type { OfficeState } from './engine/officeState.js';
import { getCatalogEntry } from './layout/furnitureCatalog.js';
import { Direction } from './types.js';

export type SeatClass = 'boardroom' | 'desk' | 'lounge';

const BOARDROOM_TYPE = 'BOARDROOM_SEAT_MARKER';
// Explicit user-placed marker for "this is a desk seat". Beats the
// adjacent-desk heuristic and works even when the desk is a DESK_MARKER (also
// invisible) on the same tile as the chair-marker.
const DESK_SEAT_TYPE = 'SEAT_MARKER';

function tileToDir(dir: Direction): { dc: number; dr: number } {
  switch (dir) {
    case Direction.UP:
      return { dc: 0, dr: -1 };
    case Direction.DOWN:
      return { dc: 0, dr: 1 };
    case Direction.LEFT:
      return { dc: -1, dr: 0 };
    case Direction.RIGHT:
      return { dc: 1, dr: 0 };
  }
}

export function classifySeat(officeState: OfficeState, seatId: string): SeatClass {
  const seat = officeState.seats.get(seatId);
  if (!seat) return 'lounge';

  // The chair furniture this seat was derived from.
  const layout = officeState.getLayout();
  const sourceFurnitureUid = seat.uid.split(':')[0];
  const source = layout.furniture.find((f) => f.uid === sourceFurnitureUid);

  // Explicit markers win — user told us exactly what they meant.
  if (source?.type === BOARDROOM_TYPE) return 'boardroom';
  if (source?.type === DESK_SEAT_TYPE) return 'desk';

  // Otherwise, heuristic: a desk-category furniture sits on the tile the
  // chair faces. Picks up regular wooden chairs paired with desks.
  const { dc, dr } = tileToDir(seat.facingDir);
  const facingCol = seat.seatCol + dc;
  const facingRow = seat.seatRow + dr;
  for (const f of layout.furniture) {
    const entry = getCatalogEntry(f.type);
    if (!entry?.isDesk) continue;
    if (
      facingCol >= f.col &&
      facingCol < f.col + entry.footprintW &&
      facingRow >= f.row &&
      facingRow < f.row + entry.footprintH
    ) {
      return 'desk';
    }
  }

  return 'lounge';
}

/**
 * Find the closest free (unassigned) seat of a given class to a starting tile.
 * Returns the seat id, or null if none free.
 */
export function findClosestFreeSeatOfClass(
  officeState: OfficeState,
  cls: SeatClass,
  fromCol: number,
  fromRow: number,
): string | null {
  const candidates: { id: string; d: number }[] = [];
  for (const [id, seat] of officeState.seats.entries()) {
    if (seat.assigned) continue;
    if (classifySeat(officeState, id) !== cls) continue;
    candidates.push({
      id,
      d: Math.abs(seat.seatCol - fromCol) + Math.abs(seat.seatRow - fromRow),
    });
  }
  candidates.sort((a, b) => a.d - b.d);
  return candidates[0]?.id ?? null;
}
