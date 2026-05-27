/**
 * Asset pipeline types — shared between the extension host, Vite build
 * scripts, browser mock, and future standalone backends.
 */

export interface CharacterDirectionSprites {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

/** A custom character pack loaded from assets/characters/<id>/character.json + sheet.png.
 *  Unlike the 6 stock palettes (which use a fixed 16×24 frame), custom packs have
 *  their own frameWidth/frameHeight and render at native quality. */
export interface CustomCharacterPack {
  id: string;
  name: string;
  description: string;
  frameWidth: number;
  frameHeight: number;
  /** Sliced sprite frames per direction (down/up/right). Left is mirrored right at runtime. */
  sprites: CharacterDirectionSprites;
  /** Animation frame indices that compose the walking cycle (default [1, 0, 2, 0]). */
  walkCycle: number[];
  /** Index of the idle/standing frame (default 0). */
  idleFrame: number;
}

export interface AssetIndex {
  floors: string[];
  walls: string[];
  characters: string[];
  defaultLayout: string | null;
}

export interface CatalogEntry {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  furniturePath: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  groupId?: string;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
  invisible?: boolean;
}
