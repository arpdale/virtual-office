/**
 * Pre-meeting participant selector. Pick which VPs to bring into the meeting
 * (or "All Hands"), then start. Supports drag-and-drop reordering — order is
 * persisted to localStorage so your preferred lineup is remembered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  VP_AVATAR_BG,
  VP_COLORS,
  VP_ERROR_COLOR,
  VP_SANS_FONT,
  VP_SCRIM_MEETING,
} from '../constants.js';
import { getHueShiftForVp } from '../office/boardroomRoster.js';
import { listVPs, type VPSummary } from '../services/boardroom.js';
import { CharacterPortrait } from './CharacterPortrait.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStart: (vpIds: string[], subject: string) => void;
}

const C = VP_COLORS;
const ORDER_KEY = 'vp-meeting-order';

function loadPersistedOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function persistOrder(ids: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function applyPersistedOrder(vps: VPSummary[], saved: string[]): VPSummary[] {
  if (!saved.length) return vps;
  const byId = new Map(vps.map((v) => [v.id, v]));
  const ordered: VPSummary[] = [];
  for (const id of saved) {
    const vp = byId.get(id);
    if (vp) {
      ordered.push(vp);
      byId.delete(id);
    }
  }
  for (const vp of byId.values()) ordered.push(vp);
  return ordered;
}

export function MeetingSelector({ isOpen, onClose, onStart }: Props) {
  const [vps, setVps] = useState<VPSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const dragNode = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    listVPs()
      .then((list) => {
        setVps(applyPersistedOrder(list, loadPersistedOrder()));
        setSelected(new Set());
      })
      .catch((e: unknown) => setError(String(e)));
  }, [isOpen]);

  const reorder = useCallback(
    (fromIdx: number, toIdx: number) => {
      if (!vps || fromIdx === toIdx) return;
      const next = [...vps];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setVps(next);
      persistOrder(next.map((v) => v.id));
    },
    [vps],
  );

  if (!isOpen) return null;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allHands = () => {
    if (!vps) return;
    setSelected(new Set(vps.map((v) => v.id)));
  };

  const clearAll = () => setSelected(new Set());

  const canStart = selected.size > 0;
  const startMeeting = () => {
    if (!canStart || !vps) return;
    const ordered = vps.filter((v) => selected.has(v.id)).map((v) => v.id);
    onStart(ordered, subject.trim() || 'Meeting');
  };

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragIdx(idx);
    dragNode.current = e.currentTarget as HTMLElement;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    requestAnimationFrame(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4';
    });
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    dragNode.current = null;
    setDragIdx(null);
    setDropIdx(null);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (idx !== dropIdx) setDropIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    if (dragIdx !== null) reorder(dragIdx, toIdx);
    handleDragEnd();
  };

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ background: VP_SCRIM_MEETING, zIndex: 80 }}
        onClick={onClose}
      />
      <div
        className="fixed vp-overlay-sans"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: C.shellBg,
          borderRadius: 16,
          boxShadow: C.shadow,
          zIndex: 81,
          width: 560,
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: VP_SANS_FONT,
          color: C.text,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Call a meeting</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
              Pick who you want at the table. Drag to reorder.
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: C.panelBg,
              border: `1px solid ${C.border}`,
              cursor: 'pointer',
              fontSize: 16,
              color: C.textMuted,
            }}
          >
            ×
          </button>
        </div>

        {/* Subject */}
        <div style={{ padding: '16px 24px 8px' }}>
          <label
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: C.textMuted,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              marginBottom: 6,
            }}
          >
            Subject (optional)
          </label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Q3 Strategy Session"
            style={{
              width: '100%',
              padding: '10px 12px',
              background: C.panelBg,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              fontFamily: VP_SANS_FONT,
              fontSize: 14,
              color: C.text,
            }}
          />
        </div>

        {/* Quick actions */}
        <div
          style={{
            padding: '12px 24px 12px',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 13, color: C.textMuted }}>
            {selected.size} of {vps?.length ?? '…'} selected
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={allHands} style={chipButton()}>
              All Hands
            </button>
            <button onClick={clearAll} style={chipButton()}>
              Clear
            </button>
          </div>
        </div>

        {/* Participant list */}
        <div
          style={{
            padding: '4px 24px 16px',
            overflowY: 'auto',
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {error && <div style={{ color: VP_ERROR_COLOR, fontSize: 13 }}>Error: {error}</div>}
          {!vps && !error && <div style={{ color: C.textMuted }}>Loading…</div>}
          {vps?.map((vp, idx) => {
            const isOn = selected.has(vp.id);
            const isDropTarget = dropIdx === idx && dragIdx !== null && dragIdx !== idx;
            return (
              <label
                key={vp.id}
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={(e) => handleDrop(e, idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  border: `1px solid ${isDropTarget ? C.accentText : isOn ? C.accentText : C.border}`,
                  background: isOn ? C.accentBg : C.panelBg,
                  borderRadius: 10,
                  cursor: 'grab',
                  boxShadow: isOn ? 'none' : C.cardShadow,
                  transition: 'background 0.15s, border-color 0.15s',
                  borderTopWidth: isDropTarget ? 3 : 1,
                  userSelect: 'none',
                }}
              >
                {/* Drag handle */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    color: C.textMuted,
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: 'grab',
                    padding: '0 2px',
                  }}
                  title="Drag to reorder"
                >
                  ⠿
                </div>

                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => toggle(vp.id)}
                  style={{ accentColor: C.accentText, width: 18, height: 18 }}
                />
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: VP_AVATAR_BG,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ width: 28, height: 36, marginBottom: -4 }}>
                    <CharacterPortrait
                      palette={vp.palette}
                      hueShift={getHueShiftForVp(vp.id)}
                      scale={3}
                      background="transparent"
                    />
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{vp.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{vp.role}</div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '14px 24px',
            borderTop: `1px solid ${C.border}`,
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button onClick={onClose} style={ghostButton()}>
            Cancel
          </button>
          <button onClick={startMeeting} disabled={!canStart} style={primaryButton(!canStart)}>
            Start Meeting →
          </button>
        </div>
      </div>
    </>
  );
}

function chipButton(): React.CSSProperties {
  return {
    background: C.panelBg,
    border: `1px solid ${C.border}`,
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    color: C.text,
    fontFamily: VP_SANS_FONT,
  };
}

function ghostButton(): React.CSSProperties {
  return {
    background: 'transparent',
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    cursor: 'pointer',
    color: C.textMuted,
    fontFamily: VP_SANS_FONT,
  };
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? C.hairline : C.accentText,
    color: disabled ? C.textMuted : C.panelBg,
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: VP_SANS_FONT,
  };
}
