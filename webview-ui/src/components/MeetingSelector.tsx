/**
 * Pre-meeting participant selector. Pick which VPs to bring into the meeting
 * (or "All Hands"), then start.
 */

import { useEffect, useState } from 'react';

import { listVPs, type VPSummary } from '../services/boardroom.js';
import { getHueShiftForVp } from '../office/boardroomRoster.js';
import { CharacterPortrait } from './CharacterPortrait.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStart: (vpIds: string[], subject: string) => void;
}

const C = {
  shellBg: '#f8f1e3',
  panelBg: '#ffffff',
  text: '#2a2a2a',
  textMuted: '#7a7367',
  border: '#eadfc9',
  hairline: '#eee8d8',
  accentBg: '#f3ebd9',
  accentText: '#7a5a3a',
  shadow: '0 4px 24px rgba(60, 40, 10, 0.18)',
  cardShadow: '0 2px 12px rgba(60, 40, 10, 0.08)',
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

export function MeetingSelector({ isOpen, onClose, onStart }: Props) {
  const [vps, setVps] = useState<VPSummary[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    listVPs()
      .then((list) => {
        setVps(list);
        // Default: select everyone
        setSelected(new Set(list.map((v) => v.id)));
      })
      .catch((e: unknown) => setError(String(e)));
  }, [isOpen]);

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
    if (!canStart) return;
    onStart([...selected], subject.trim() || 'Board Meeting');
  };

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ background: 'rgba(20, 14, 6, 0.6)', zIndex: 80 }}
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
          fontFamily: SANS,
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
            <div style={{ fontSize: 20, fontWeight: 700 }}>Call a board meeting</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>
              Pick who you want at the table.
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
              fontFamily: SANS,
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
          {error && <div style={{ color: '#c0392b', fontSize: 13 }}>Error: {error}</div>}
          {!vps && !error && <div style={{ color: C.textMuted }}>Loading…</div>}
          {vps?.map((vp) => {
            const isOn = selected.has(vp.id);
            return (
              <label
                key={vp.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  border: `1px solid ${isOn ? C.accentText : C.border}`,
                  background: isOn ? C.accentBg : C.panelBg,
                  borderRadius: 10,
                  cursor: 'pointer',
                  boxShadow: isOn ? 'none' : C.cardShadow,
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
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
                    background: '#d9c8a8',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ width: 28, height: 36, marginBottom: -4 }}>
                    <CharacterPortrait palette={vp.palette} hueShift={getHueShiftForVp(vp.id)} scale={3} background="transparent" />
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
          <button
            onClick={startMeeting}
            disabled={!canStart}
            style={primaryButton(!canStart)}
          >
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
    fontFamily: SANS,
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
    fontFamily: SANS,
  };
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? C.hairline : C.accentText,
    color: disabled ? C.textMuted : '#ffffff',
    border: 'none',
    borderRadius: 10,
    padding: '10px 18px',
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: SANS,
  };
}
