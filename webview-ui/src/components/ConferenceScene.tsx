/**
 * Conference scene for the Board Meeting overlay.
 *
 * Renders selected VP sprites in a row "seated" at a wooden table, facing
 * the viewer. Each character has a name label below them. A "screen" at the
 * top shows the meeting subject.
 *
 * Pure decorative — the real walk-to-seat happens in the office canvas
 * underneath. This is a stylized cinematic view of who's at the meeting.
 */

import { useEffect, useRef } from 'react';

import {
  CONF_BOOK_COLORS,
  CONF_BOOKSHELF_COLOR,
  CONF_CHAIR_COLOR,
  CONF_CITY_SILHOUETTE,
  CONF_CONTAINER_BG,
  CONF_CONTAINER_SHADOW,
  CONF_FLOOR_BOTTOM,
  CONF_FLOOR_TOP,
  CONF_LABEL_BG,
  CONF_LABEL_BORDER,
  CONF_LABEL_ROLE_COLOR,
  CONF_LABEL_SHADOW,
  CONF_LABEL_TEXT,
  CONF_NO_PARTICIPANTS,
  CONF_PLACEHOLDER_COLOR,
  CONF_PLANK_LINE,
  CONF_SCREEN_BG,
  CONF_SCREEN_SUBTITLE,
  CONF_SCREEN_TITLE,
  CONF_SHELF_LINE,
  CONF_TABLE_BOTTOM,
  CONF_TABLE_HIGHLIGHT,
  CONF_TABLE_TOP,
  CONF_WALL_DARK,
  CONF_WALL_LIGHT,
  CONF_WINDOW_BG,
  CONF_WINDOW_GLOW,
  VP_SANS_FONT,
} from '../constants.js';
import { getHueShiftForVp } from '../office/boardroomRoster.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { SpriteData } from '../office/types.js';
import { Direction as Dir } from '../office/types.js';
import type { VPSummary } from '../services/boardroom.js';

interface Props {
  participants: VPSummary[];
}

const SPRITE_W = 16;
const SPRITE_H = 24;

function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: SpriteData,
  x: number,
  y: number,
  scale: number,
) {
  for (let sy = 0; sy < sprite.length; sy++) {
    const row = sprite[sy];
    for (let sx = 0; sx < row.length; sx++) {
      const color = row[sx];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + sx * scale, y + sy * scale, scale, scale);
    }
  }
}

export function ConferenceScene({ participants }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const containerRect = container.getBoundingClientRect();
    const w = Math.max(640, containerRect.width);
    const h = Math.max(280, containerRect.height);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // ── Background ────────────────────────────────────────
    // Wall (top 55%): warm dark brown gradient
    const wallH = Math.floor(h * 0.55);
    const wallGrad = ctx.createLinearGradient(0, 0, 0, wallH);
    wallGrad.addColorStop(0, CONF_WALL_DARK);
    wallGrad.addColorStop(1, CONF_WALL_LIGHT);
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, w, wallH);

    // Bookshelves silhouettes on either side
    drawBookshelf(ctx, 6, wallH - 90, 80, 90, CONF_BOOKSHELF_COLOR);
    drawBookshelf(ctx, w - 86, wallH - 90, 80, 90, CONF_BOOKSHELF_COLOR);

    // Window in the middle background
    const winX = 96;
    const winW = w - 192;
    const winY = 16;
    const winH = wallH - 110;
    ctx.fillStyle = CONF_WINDOW_BG;
    ctx.fillRect(winX, winY, winW, winH);
    // Window panes
    ctx.strokeStyle = CONF_WALL_DARK;
    ctx.lineWidth = 3;
    ctx.strokeRect(winX, winY, winW, winH);
    ctx.beginPath();
    ctx.moveTo(winX + winW / 2, winY);
    ctx.lineTo(winX + winW / 2, winY + winH);
    ctx.moveTo(winX, winY + winH / 2);
    ctx.lineTo(winX + winW, winY + winH / 2);
    ctx.stroke();
    // City silhouette
    ctx.fillStyle = CONF_CITY_SILHOUETTE;
    for (let i = 0; i < 10; i++) {
      const bx = winX + 8 + i * ((winW - 16) / 10);
      const bw = (winW - 16) / 10 - 4;
      const bh = 30 + ((i * 13) % 50);
      ctx.fillRect(bx, winY + winH - bh, bw, bh);
    }
    // Window glow
    ctx.fillStyle = CONF_WINDOW_GLOW;
    ctx.fillRect(winX, winY, winW, winH);

    // Presentation screen (centered, on the wall)
    const screenW = Math.min(280, winW * 0.7);
    const screenH = 70;
    const screenX = (w - screenW) / 2;
    const screenY = winY + 14;
    ctx.fillStyle = CONF_SCREEN_BG;
    roundRect(ctx, screenX, screenY, screenW, screenH, 6);
    ctx.fill();
    ctx.fillStyle = CONF_SCREEN_TITLE;
    ctx.font = `bold 14px ${VP_SANS_FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('goodleap', screenX + screenW / 2, screenY + 28);
    ctx.font = `11px ${VP_SANS_FONT}`;
    ctx.fillStyle = CONF_SCREEN_SUBTITLE;
    ctx.fillText('Meeting in session', screenX + screenW / 2, screenY + 48);

    // Floor (bottom 45%): wood plank gradient
    const floorY = wallH;
    const floorH = h - wallH;
    const floorGrad = ctx.createLinearGradient(0, floorY, 0, floorY + floorH);
    floorGrad.addColorStop(0, CONF_FLOOR_TOP);
    floorGrad.addColorStop(1, CONF_FLOOR_BOTTOM);
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, floorY, w, floorH);
    // Plank lines
    ctx.strokeStyle = CONF_PLANK_LINE;
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = floorY + (i * floorH) / 8;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Table (wood, in front of characters' lower halves)
    const tableY = h - 60;
    const tableH = 50;
    const tableGrad = ctx.createLinearGradient(0, tableY, 0, tableY + tableH);
    tableGrad.addColorStop(0, CONF_TABLE_TOP);
    tableGrad.addColorStop(1, CONF_TABLE_BOTTOM);
    ctx.fillStyle = tableGrad;
    ctx.fillRect(0, tableY, w, tableH);
    // Table edge highlight
    ctx.fillStyle = CONF_TABLE_HIGHLIGHT;
    ctx.fillRect(0, tableY, w, 3);

    // ── Characters ───────────────────────────────────────
    if (participants.length === 0) {
      ctx.fillStyle = CONF_NO_PARTICIPANTS;
      ctx.font = `14px ${VP_SANS_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('No participants', w / 2, h / 2);
      return;
    }

    const scale = 4;
    const spriteW = SPRITE_W * scale;
    const spriteH = SPRITE_H * scale;
    const slotW = (w - 80) / participants.length;
    const baseY = tableY - spriteH + 12; // characters sit so the table covers their lower torso
    participants.forEach((vp, i) => {
      const cx = 40 + slotW * (i + 0.5);
      const x = Math.floor(cx - spriteW / 2);
      const y = Math.floor(baseY);
      try {
        const sprites = getCharacterSprites(vp.palette, getHueShiftForVp(vp.id));
        // walk[DOWN][1] is the idle/standing pose facing viewer
        const standing = sprites.walk[Dir.DOWN][1];
        // Chair behind character — small dark rect
        ctx.fillStyle = CONF_CHAIR_COLOR;
        ctx.fillRect(x - 4, y + spriteH * 0.55, spriteW + 8, 18);
        drawSprite(ctx, standing, x, y, scale);
      } catch {
        // sprite not loaded yet — placeholder
        ctx.fillStyle = CONF_PLACEHOLDER_COLOR;
        ctx.fillRect(x, y, spriteW, spriteH);
      }
    });
  }, [participants]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 12,
        overflow: 'hidden',
        background: CONF_CONTAINER_BG,
        boxShadow: CONF_CONTAINER_SHADOW,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', imageRendering: 'pixelated' }} />
      {/* Name labels — positioned in CSS overlay so they're crisp text */}
      <NameLabels participants={participants} />
    </div>
  );
}

function NameLabels({ participants }: { participants: VPSummary[] }) {
  if (participants.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 8,
        display: 'flex',
        justifyContent: 'space-around',
        padding: '0 32px',
        pointerEvents: 'none',
      }}
    >
      {participants.map((vp) => (
        <div
          key={vp.id}
          style={{
            background: CONF_LABEL_BG,
            border: `1px solid ${CONF_LABEL_BORDER}`,
            borderRadius: 8,
            padding: '4px 10px',
            boxShadow: CONF_LABEL_SHADOW,
            textAlign: 'center',
            minWidth: 90,
            fontSize: 12,
            fontWeight: 600,
            color: CONF_LABEL_TEXT,
            fontFamily: VP_SANS_FONT,
          }}
        >
          <div style={{ whiteSpace: 'nowrap' }}>{vp.name}</div>
          <div style={{ fontSize: 10, color: CONF_LABEL_ROLE_COLOR, fontWeight: 400 }}>
            {vp.role}
          </div>
        </div>
      ))}
    </div>
  );
}

function drawBookshelf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // Shelves
  ctx.fillStyle = CONF_SHELF_LINE;
  for (let i = 1; i < 4; i++) {
    ctx.fillRect(x, y + (i * h) / 4 - 1, w, 2);
  }
  // Books
  const colors = CONF_BOOK_COLORS;
  for (let row = 0; row < 4; row++) {
    let bx = x + 4;
    while (bx < x + w - 4) {
      const bw = 4 + ((row * 7 + bx) % 6);
      const bh = h / 4 - 6;
      ctx.fillStyle = colors[(row + bx) % colors.length];
      ctx.fillRect(bx, y + (row * h) / 4 + 3, bw, bh);
      bx += bw + 1;
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
