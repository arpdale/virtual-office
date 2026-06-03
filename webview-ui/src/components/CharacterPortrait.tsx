/**
 * Renders a VP's pixel sprite at large scale, standing pose, on a styled
 * office background. Used in the VPOverlay right column.
 */

import { useEffect, useRef } from 'react';

import { PORTRAIT_DEFAULT_BG, PORTRAIT_RUG_COLOR, PORTRAIT_RUG_SHADOW } from '../constants.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { SpriteData } from '../office/types.js';
import { Direction as Dir } from '../office/types.js';

interface Props {
  palette: number;
  hueShift?: number;
  /** Scale factor; default 12 (the sprite body is 16x24, so 16*12=192 px wide × 24*12=288 px tall) */
  scale?: number;
  /** Background style — CSS gradient or color */
  background?: string;
}

const SPRITE_W = 16;
const SPRITE_H = 24;

function drawSprite(ctx: CanvasRenderingContext2D, sprite: SpriteData, scale: number) {
  for (let y = 0; y < sprite.length; y++) {
    const row = sprite[y];
    for (let x = 0; x < row.length; x++) {
      const color = row[x];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

export function CharacterPortrait({ palette, hueShift = 0, scale = 14, background }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = SPRITE_W * scale;
    canvas.height = SPRITE_H * scale;

    // walk[DOWN][1] is the standing/idle pose per the spec
    const sprites = getCharacterSprites(palette, hueShift);
    const standing = sprites.walk[Dir.DOWN][1];
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSprite(ctx, standing, scale);
  }, [palette, hueShift, scale]);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{
        background: background ?? PORTRAIT_DEFAULT_BG,
      }}
    >
      {/* Subtle rug rectangle behind the character */}
      <div
        className="absolute"
        style={{
          left: '15%',
          right: '15%',
          bottom: '5%',
          height: '15%',
          background: PORTRAIT_RUG_COLOR,
          borderRadius: '4px',
          boxShadow: PORTRAIT_RUG_SHADOW,
        }}
      />
      <canvas
        ref={canvasRef}
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          imageRendering: 'pixelated',
          bottom: '12%',
        }}
      />
    </div>
  );
}
