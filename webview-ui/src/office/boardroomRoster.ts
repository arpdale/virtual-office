/**
 * Boardroom roster — dynamic replacement for the static EMPLOYEE_ROSTER.
 *
 * On boot we fetch /vps from the boardroom backend and spawn one office
 * character per VP. We maintain a bidirectional map between the synthetic
 * numeric `characterId` (used by OfficeState) and the backend `vp_id` (string),
 * so that clicks on a character can deep-link to the right VP overlay.
 *
 * Numeric ids start at 1001 to mirror the legacy roster's `>= 1000` invariant.
 */

import { listVPs, type VPSummary } from '../services/boardroom.js';
import type { OfficeState } from './engine/officeState.js';
import { classifySeat, findClosestFreeSeatOfClass } from './seatClassifier.js';
import { CharacterState } from './types.js';

const ID_BASE = 1001;

const vpIdByCharacterId = new Map<number, string>();
const characterIdByVpId = new Map<string, number>();
let nextNumericId = ID_BASE;

export function getVpIdForCharacter(characterId: number): string | undefined {
  return vpIdByCharacterId.get(characterId);
}

export function getCharacterIdForVp(vpId: string): number | undefined {
  return characterIdByVpId.get(vpId);
}

/** Hue shift applied to the VP's character sprite to avoid look-alikes when
 *  palettes repeat. Use this when rendering the same sprite outside the
 *  office (portraits, avatars in chat) so the overlay matches what walks
 *  around. */
export function getHueShiftForVp(vpId: string): number {
  return hueShiftByVpId.get(vpId) ?? 0;
}

// Stable hue-shift per VP. Computed deterministically from the full VP
// roster — NOT from spawn order — so a given VP always looks the same in
// the office regardless of timing/StrictMode/HMR.
const hueShiftByVpId = new Map<string, number>();

// Subtle warm/cool + bolder non-green shifts. Skipping the green zone (60-150
// hue rotation from skin tones is sickly green).
const HUE_CHOICES = [20, 340, 40, 320, 200, 220, 280];

/**
 * Compute hue-shift assignments for the entire roster at once.
 * For each palette, the VP with the alphabetically smallest id gets hueShift=0
 * (the "canonical" appearance for that palette); subsequent VPs sharing the
 * palette get distinct shifts from HUE_CHOICES, deterministically picked from
 * a hash of their vp_id.
 */
export function computeHueShifts(
  vps: { id: string; palette: number }[],
): void {
  hueShiftByVpId.clear();
  // Group VPs by palette
  const byPalette = new Map<number, { id: string; palette: number }[]>();
  for (const vp of vps) {
    const arr = byPalette.get(vp.palette) ?? [];
    arr.push(vp);
    byPalette.set(vp.palette, arr);
  }
  // For each group, sort by id and assign
  for (const group of byPalette.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 0; i < group.length; i++) {
      const vp = group[i];
      if (i === 0) {
        hueShiftByVpId.set(vp.id, 0);
      } else {
        // Hash vp_id into a stable choice
        let seed = 0;
        for (let j = 0; j < vp.id.length; j++) seed = (seed * 31 + vp.id.charCodeAt(j)) | 0;
        const shift = HUE_CHOICES[Math.abs(seed) % HUE_CHOICES.length];
        hueShiftByVpId.set(vp.id, shift);
      }
    }
  }
}

function lookupOrComputeShift(vpId: string, palette: number): number {
  const cached = hueShiftByVpId.get(vpId);
  if (cached !== undefined) return cached;
  // Falls through if a VP was added without a prior computeHueShifts(). Assign
  // a stable hash-based shift so they aren't identical to anyone else; safe
  // for wizard-added late entrants.
  let seed = 0;
  for (let i = 0; i < vpId.length; i++) seed = (seed * 31 + vpId.charCodeAt(i)) | 0;
  const shift = HUE_CHOICES[Math.abs(seed) % HUE_CHOICES.length];
  hueShiftByVpId.set(vpId, shift);
  return shift;
}

function _spawn(officeState: OfficeState, vp: VPSummary): number {
  // Reuse existing id if we've seen this vp before, else allocate a new one
  let charId = characterIdByVpId.get(vp.id);
  if (charId === undefined) {
    charId = nextNumericId++;
    characterIdByVpId.set(vp.id, charId);
    vpIdByCharacterId.set(charId, vp.id);
  }
  if (!officeState.characters.has(charId)) {
    const hueShift = lookupOrComputeShift(vp.id, vp.palette);
    officeState.addAgent(charId, vp.palette, hueShift);
  }
  const ch = officeState.characters.get(charId);
  if (ch) {
    ch.displayName = vp.name;
    ch.role = vp.role;
    ch.description = vp.description;
    ch.isActive = false; // wander, don't sit at desk forever

    // Reassign their auto-picked seat to a DESK seat (D chair) if they got
    // something else (e.g. a lounge couch or a boardroom marker).
    const currentClass = ch.seatId ? classifySeat(officeState, ch.seatId) : null;
    if (currentClass !== 'desk') {
      const deskId = findClosestFreeSeatOfClass(officeState, 'desk', ch.tileCol, ch.tileRow);
      if (deskId) {
        if (ch.seatId && officeState.seats.has(ch.seatId)) {
          officeState.seats.get(ch.seatId)!.assigned = false;
        }
        officeState.seats.get(deskId)!.assigned = true;
        ch.seatId = deskId;
      }
    }
  }
  return charId;
}

/**
 * Fetch the full roster and spawn characters. Idempotent: re-running adds any
 * new VPs without disturbing the existing ones (e.g. after committing a new
 * VP via the onboarding wizard).
 */
export async function loadBoardroomVPs(officeState: OfficeState): Promise<VPSummary[]> {
  const vps = await listVPs();
  // Hue-shift differentiation is disabled while we iterate on the look.
  // Everyone uses their assigned palette directly, hueShift=0. If two VPs
  // share a palette they'll look the same — we'll address that with a
  // proper palette swap UI rather than auto-tinting.
  hueShiftByVpId.clear();
  for (const vp of vps) {
    hueShiftByVpId.set(vp.id, 0);
    _spawn(officeState, vp);
  }
  return vps;
}

/**
 * Spawn a single newly-created VP and return its characterId. Used after the
 * onboarding wizard commits.
 */
export function spawnBoardroomVP(officeState: OfficeState, vp: VPSummary): number {
  return _spawn(officeState, vp);
}

/**
 * Set whether a VP is "actively working" — flipping this to true makes the
 * character walk to their seat and sit down typing. Flipping to false stands
 * them up and starts wandering. Powers the chat → walk-to-desk demo.
 *
 * When activating, we:
 *   - Check that the assigned desk seat is actually reachable from the
 *     character's current position. If not, find any reachable free seat
 *     and reassign on the fly so they don't end up "sitting in the kitchen"
 *     while the system thinks they're at their desk.
 *   - Clear any in-progress wander path and drop to IDLE so the FSM
 *     immediately re-pathfinds.
 */
export function setVPActive(
  officeState: OfficeState,
  vpId: string,
  active: boolean,
): boolean {
  const charId = characterIdByVpId.get(vpId);
  if (charId === undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[boardroom] setVPActive: no character for vp_id=${vpId}`);
    return false;
  }
  const ch = officeState.characters.get(charId);
  if (!ch) return false;

  if (active) {
    // Working mode: VPs go to DESK chairs (D), not couches or boardroom seats.
    // If their current seat isn't a desk OR isn't reachable, find the closest
    // reachable free desk seat and swap them to it.
    const currentSeat = ch.seatId ? officeState.seats.get(ch.seatId) : null;
    const currentClass = ch.seatId ? classifySeat(officeState, ch.seatId) : null;
    const currentReachable = currentSeat
      ? officeState.canCharacterReachTile(charId, currentSeat.seatCol, currentSeat.seatRow)
      : false;
    const currentOk = currentClass === 'desk' && currentReachable;

    if (!currentOk) {
      // Build list of unassigned desk seats, sort by distance, take first reachable.
      const candidates: { seatId: string; col: number; row: number; d: number }[] = [];
      for (const [seatId, seat] of officeState.seats.entries()) {
        if (seat.assigned && seatId !== ch.seatId) continue;
        if (classifySeat(officeState, seatId) !== 'desk') continue;
        candidates.push({
          seatId,
          col: seat.seatCol,
          row: seat.seatRow,
          d: Math.abs(seat.seatCol - ch.tileCol) + Math.abs(seat.seatRow - ch.tileRow),
        });
      }
      candidates.sort((a, b) => a.d - b.d);

      let swapped = false;
      for (const cand of candidates) {
        if (officeState.canCharacterReachTile(charId, cand.col, cand.row)) {
          if (ch.seatId && officeState.seats.has(ch.seatId)) {
            officeState.seats.get(ch.seatId)!.assigned = false;
          }
          const newSeat = officeState.seats.get(cand.seatId)!;
          newSeat.assigned = true;
          ch.seatId = cand.seatId;
          swapped = true;
          break;
        }
      }
      if (!swapped) {
        // eslint-disable-next-line no-console
        console.warn(`[boardroom] ${vpId}: no reachable DESK seat from current position`);
      }
    }

    ch.isActive = true;
    // Interrupt any current wander so they head straight to their seat.
    ch.path = [];
    ch.moveProgress = 0;
    if (ch.state === CharacterState.WALK) {
      ch.state = CharacterState.IDLE;
      ch.frame = 0;
      ch.frameTimer = 0;
    }
  } else {
    ch.isActive = false;
  }
  return true;
}
