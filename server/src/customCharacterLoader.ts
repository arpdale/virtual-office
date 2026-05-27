import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';

import type {
  CharacterDirectionSprites,
  CustomCharacterPack,
} from '../../core/src/assets/types.js';

/** Manifest format read from a character pack's character.json. */
interface CharacterManifest {
  id: string;
  name: string;
  description?: string;
  frameWidth: number;
  frameHeight: number;
  /** Row order in the sheet. Engine consumes down/up/right; left (if present in the sheet)
   *  is ignored because the renderer mirrors right at runtime. */
  rows: string[];
  framesPerRow: number;
  walkCycle?: number[];
  idleFrame?: number;
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  if (a < 2) return '';
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  if (a >= 254) return `#${hex(r)}${hex(g)}${hex(b)}`;
  return `#${hex(r)}${hex(g)}${hex(b)}${hex(a)}`;
}

/** Slice one cell out of a decoded PNG into a SpriteData (2D hex array). */
function sliceCellToSprite(
  png: { data: Buffer; width: number },
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
): string[][] {
  const sprite: string[][] = [];
  for (let y = 0; y < cellH; y++) {
    const row: string[] = [];
    for (let x = 0; x < cellW; x++) {
      const idx = ((cellY + y) * png.width + (cellX + x)) * 4;
      row.push(rgbaToHex(png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

/** Load a single character pack from a directory containing character.json + sheet.png. */
function loadOnePack(packDir: string): CustomCharacterPack | null {
  const manifestPath = path.join(packDir, 'character.json');
  const sheetPath = path.join(packDir, 'sheet.png');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(sheetPath)) return null;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as CharacterManifest;
  const png = PNG.sync.read(fs.readFileSync(sheetPath));
  const { frameWidth: fw, frameHeight: fh, rows, framesPerRow } = manifest;

  // Map sheet rows to engine directions. The engine only cares about down/up/right.
  const dirSprites: CharacterDirectionSprites = { down: [], up: [], right: [] };
  const dirMap: Record<string, 'down' | 'up' | 'right'> = {
    down: 'down',
    front: 'down',
    up: 'up',
    back: 'up',
    right: 'right',
    side: 'right',
  };
  for (let r = 0; r < rows.length; r++) {
    const target = dirMap[rows[r]];
    if (!target) continue; // skip "left" — runtime mirrors right
    const frames: string[][][] = [];
    for (let f = 0; f < framesPerRow; f++) {
      frames.push(sliceCellToSprite(png, f * fw, r * fh, fw, fh));
    }
    dirSprites[target] = frames;
  }

  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? '',
    frameWidth: fw,
    frameHeight: fh,
    sprites: dirSprites,
    walkCycle: manifest.walkCycle ?? [1, 0, 2, 0],
    idleFrame: manifest.idleFrame ?? 0,
  };
}

/** Scan assets/characters/<id>/ folders that contain character.json. Returns one pack per folder. */
export function loadCustomCharacterPacks(assetsRoot: string): CustomCharacterPack[] {
  const charDir = path.join(assetsRoot, 'assets', 'characters');
  if (!fs.existsSync(charDir)) return [];

  const packs: CustomCharacterPack[] = [];
  for (const entry of fs.readdirSync(charDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pack = loadOnePack(path.join(charDir, entry.name));
    if (pack) {
      packs.push(pack);
      console.log(
        `[AssetLoader] ✅ Loaded custom character pack "${pack.id}" (${pack.frameWidth}×${pack.frameHeight}, ${pack.sprites.down.length} frames)`,
      );
    }
  }
  return packs;
}
