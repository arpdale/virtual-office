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

import type { VPSummary } from '../services/boardroom.js';
import { getHueShiftForVp } from '../office/boardroomRoster.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import { Direction as Dir } from '../office/types.js';
import type { SpriteData } from '../office/sprites/spriteData.js';

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
    wallGrad.addColorStop(0, '#3a2e1f');
    wallGrad.addColorStop(1, '#5a4631');
    ctx.fillStyle = wallGrad;
    ctx.fillRect(0, 0, w, wallH);

    // Bookshelves silhouettes on either side
    drawBookshelf(ctx, 6, wallH - 90, 80, 90, '#2a1e10');
    drawBookshelf(ctx, w - 86, wallH - 90, 80, 90, '#2a1e10');

    // Window in the middle background
    const winX = 96;
    const winW = w - 192;
    const winY = 16;
    const winH = wallH - 110;
    ctx.fillStyle = '#1a2a3e';
    ctx.fillRect(winX, winY, winW, winH);
    // Window panes
    ctx.strokeStyle = '#3a2e1f';
    ctx.lineWidth = 3;
    ctx.strokeRect(winX, winY, winW, winH);
    ctx.beginPath();
    ctx.moveTo(winX + winW / 2, winY);
    ctx.lineTo(winX + winW / 2, winY + winH);
    ctx.moveTo(winX, winY + winH / 2);
    ctx.lineTo(winX + winW, winY + winH / 2);
    ctx.stroke();
    // City silhouette
    ctx.fillStyle = '#0a1420';
    for (let i = 0; i < 10; i++) {
      const bx = winX + 8 + i * ((winW - 16) / 10);
      const bw = (winW - 16) / 10 - 4;
      const bh = 30 + (i * 13) % 50;
      ctx.fillRect(bx, winY + winH - bh, bw, bh);
    }
    // Window glow
    ctx.fillStyle = 'rgba(255, 220, 160, 0.06)';
    ctx.fillRect(winX, winY, winW, winH);

    // Presentation screen (centered, on the wall)
    const screenW = Math.min(280, winW * 0.7);
    const screenH = 70;
    const screenX = (w - screenW) / 2;
    const screenY = winY + 14;
    ctx.fillStyle = '#f5efe2';
    roundRect(ctx, screenX, screenY, screenW, screenH, 6);
    ctx.fill();
    ctx.fillStyle = '#7a5a3a';
    ctx.font =
      'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('goodleap', screenX + screenW / 2, screenY + 28);
    ctx.font =
      '11px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = '#5a4631';
    ctx.fillText('Board Meeting in session', screenX + screenW / 2, screenY + 48);

    // Floor (bottom 45%): wood plank gradient
    const floorY = wallH;
    const floorH = h - wallH;
    const floorGrad = ctx.createLinearGradient(0, floorY, 0, floorY + floorH);
    floorGrad.addColorStop(0, '#6b4f33');
    floorGrad.addColorStop(1, '#4a3520');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, floorY, w, floorH);
    // Plank lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
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
    tableGrad.addColorStop(0, '#6e4f31');
    tableGrad.addColorStop(1, '#3a2515');
    ctx.fillStyle = tableGrad;
    ctx.fillRect(0, tableY, w, tableH);
    // Table edge highlight
    ctx.fillStyle = 'rgba(255, 220, 160, 0.15)';
    ctx.fillRect(0, tableY, w, 3);

    // ── Characters ───────────────────────────────────────
    if (participants.length === 0) {
      ctx.fillStyle = '#bba07a';
      ctx.font =
        '14px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
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
        ctx.fillStyle = '#2a1e10';
        ctx.fillRect(x - 4, y + spriteH * 0.55, spriteW + 8, 18);
        drawSprite(ctx, standing, x, y, scale);
      } catch {
        // sprite not loaded yet — placeholder
        ctx.fillStyle = '#d9c8a8';
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
        background: '#3a2e1f',
        boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.1)',
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
            background: '#ffffff',
            border: '1px solid #eadfc9',
            borderRadius: 8,
            padding: '4px 10px',
            boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)',
            textAlign: 'center',
            minWidth: 90,
            fontSize: 12,
            fontWeight: 600,
            color: '#2a2a2a',
            fontFamily:
              '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
          }}
        >
          <div style={{ whiteSpace: 'nowrap' }}>{vp.name}</div>
          <div style={{ fontSize: 10, color: '#7a7367', fontWeight: 400 }}>{vp.role}</div>
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
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  for (let i = 1; i < 4; i++) {
    ctx.fillRect(x, y + (i * h) / 4 - 1, w, 2);
  }
  // Books
  const colors = ['#5a3a25', '#8b6b3a', '#c08a4e', '#6d4520'];
  for (let row = 0; row < 4; row++) {
    let bx = x + 4;
    while (bx < x + w - 4) {
      const bw = 4 + (row * 7 + bx) % 6;
      const bh = (h / 4) - 6;
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
