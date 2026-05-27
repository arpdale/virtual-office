/**
 * Board Meeting overlay — chat-driven group session.
 *
 * Layout:
 *   - Header: title, subject, "In Progress" badge, elapsed timer, End button
 *   - Top half: Conference Scene with all selected VPs as sprites
 *   - Bottom half: Group Chat that broadcasts to selected VPs in parallel
 *
 * Each user message fans out to all participants via /vp/{id}/chat. Responses
 * stream back tagged with the speaker's name + avatar. User can @mention a
 * specific VP to direct a question; otherwise broadcast.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type VPSummary, listVPs, streamChat } from '../services/boardroom.js';
import {
  getCharacterIdForVp,
  getHueShiftForVp,
  setVPActive,
} from '../office/boardroomRoster.js';
import { adjournBoardMeeting, callBoardMeeting } from '../office/boardMeeting.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { ConferenceScene } from './ConferenceScene.js';
import { CharacterPortrait } from './CharacterPortrait.js';

interface Props {
  isOpen: boolean;
  participantIds: string[];
  subject: string;
  officeState: OfficeState;
  onClose: () => void;
}

const C = {
  shellBg: '#f8f1e3',
  panelBg: '#ffffff',
  text: '#2a2a2a',
  textMuted: '#7a7367',
  border: '#eadfc9',
  hairline: '#eee8d8',
  badgeBg: '#dceedd',
  badgeText: '#22a06b',
  accentText: '#7a5a3a',
  accentBg: '#f3ebd9',
  cardShadow: '0 2px 12px rgba(60, 40, 10, 0.08)',
  shadow: '0 4px 24px rgba(60, 40, 10, 0.18)',
};

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

interface MeetingMessage {
  id: string;
  who: 'you' | 'vp';
  vpId?: string;
  vpName?: string;
  vpRole?: string;
  vpPalette?: number;
  vpHueShift?: number;
  text: string;
  pending?: boolean;
  ts: Date;
}

export function BoardMeetingOverlay({
  isOpen,
  participantIds,
  subject,
  officeState,
  onClose,
}: Props) {
  const [allVPs, setAllVPs] = useState<VPSummary[]>([]);
  const [messages, setMessages] = useState<MeetingMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sendingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startedAt = useRef<Date | null>(null);

  // Load full VP roster so we can resolve names/roles/palettes from ids
  useEffect(() => {
    if (!isOpen) return;
    listVPs()
      .then(setAllVPs)
      .catch(() => {});
  }, [isOpen]);

  // Start: walk participants to seats, start the timer
  useEffect(() => {
    if (!isOpen) return;
    startedAt.current = new Date();
    setElapsed(0);
    setMessages([]);
    setDraft('');
    callBoardMeeting(officeState, participantIds);
    const id = setInterval(() => {
      if (startedAt.current) {
        setElapsed(Math.floor((Date.now() - startedAt.current.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isOpen, participantIds, officeState]);

  // Esc to close
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Auto-scroll chat — but only when the user is already near the bottom.
  // If they've scrolled up to read, don't yank them back down on each token.
  const stickToBottomRef = useRef(true);
  const onScrollContainer = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
    stickToBottomRef.current = dist < 80; // within 80px of bottom = "stuck"
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Resolve participant summaries from ids
  const participants = useMemo(() => {
    const byId = new Map(allVPs.map((v) => [v.id, v]));
    return participantIds
      .map((id) => byId.get(id))
      .filter((v): v is VPSummary => !!v);
  }, [allVPs, participantIds]);

  const endMeeting = useCallback(() => {
    adjournBoardMeeting(officeState);
    for (const id of participantIds) {
      setVPActive(officeState, id, false);
    }
    onClose();
  }, [officeState, participantIds, onClose]);

  // Determine who a message is addressed to.
  // - "@firstname …" or "@First Last …" → just that VP (case-insensitive)
  // - otherwise → broadcast to all participants
  const resolveAddressees = useCallback(
    (text: string): VPSummary[] => {
      const match = text.match(/^@(\S+)\s+/);
      if (!match) return participants;
      const needle = match[1].toLowerCase();
      const hit = participants.find((p) => {
        const first = p.name.split(' ')[0]?.toLowerCase() ?? '';
        return first === needle || p.name.toLowerCase() === needle;
      });
      return hit ? [hit] : participants;
    },
    [participants],
  );

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendingRef.current || participants.length === 0) return;
    sendingRef.current = true;
    setStreaming(true);
    setDraft('');

    const userMsgId = `you-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, who: 'you', text, ts: new Date() },
    ]);

    const addressees = resolveAddressees(text);
    for (const vp of addressees) {
      setVPActive(officeState, vp.id, true);
    }

    // Round-robin: each VP responds in order, fully, before the next one
    // starts. Feels like real meeting rhythm; user can follow each thread.
    for (let i = 0; i < addressees.length; i++) {
      const vp = addressees[i];
      const slotId = `vp-${vp.id}-${Date.now()}-${i}`;

      // Pre-create this VP's bubble in "typing…" state
      setMessages((prev) => [
        ...prev,
        {
          id: slotId,
          who: 'vp',
          vpId: vp.id,
          vpName: vp.name,
          vpRole: vp.role,
          vpPalette: vp.palette,
          vpHueShift: getHueShiftForVp(vp.id),
          text: '',
          pending: true,
          ts: new Date(),
        },
      ]);

      try {
        await streamChat(vp.id, text, {
          onToken: (chunk) => {
            setMessages((prev) => {
              const j = prev.findIndex((m) => m.id === slotId);
              if (j === -1) return prev;
              const next = [...prev];
              next[j] = { ...next[j], text: next[j].text + chunk };
              return next;
            });
          },
          onDone: () => {
            setMessages((prev) => {
              const j = prev.findIndex((m) => m.id === slotId);
              if (j === -1) return prev;
              const next = [...prev];
              next[j] = { ...next[j], pending: false };
              return next;
            });
          },
          onError: (msg) => {
            setMessages((prev) => {
              const j = prev.findIndex((m) => m.id === slotId);
              if (j === -1) return prev;
              const next = [...prev];
              next[j] = { ...next[j], text: `(error: ${msg})`, pending: false };
              return next;
            });
          },
        });
      } catch (err: unknown) {
        setMessages((prev) => {
          const j = prev.findIndex((m) => m.id === slotId);
          if (j === -1) return prev;
          const next = [...prev];
          next[j] = { ...next[j], text: `(error: ${String(err)})`, pending: false };
          return next;
        });
      }
    }

    sendingRef.current = false;
    setStreaming(false);
  }, [draft, participants, officeState, resolveAddressees]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ background: 'rgba(20, 14, 6, 0.65)', zIndex: 70 }}
        onClick={endMeeting}
      />
      <div
        className="fixed flex flex-col vp-overlay-sans"
        style={{
          inset: '3vh 3vw',
          background: C.shellBg,
          borderRadius: 16,
          boxShadow: C.shadow,
          zIndex: 71,
          color: C.text,
          fontFamily: SANS,
          fontSize: 15,
          lineHeight: 1.5,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <Header
          subject={subject}
          participantCount={participants.length}
          elapsed={elapsed}
          onEnd={endMeeting}
        />

        {/* Main two-pane: scene top, chat bottom */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Top: conference scene + side participant list */}
          <div
            style={{
              flex: '0 0 45%',
              display: 'flex',
              minHeight: 0,
              borderBottom: `1px solid ${C.border}`,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, padding: 16 }}>
              <ConferenceScene participants={participants} />
            </div>
            <ParticipantsPanel participants={participants} />
          </div>

          {/* Bottom: group chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '12px 24px 6px', borderBottom: `1px solid ${C.hairline}`, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Meeting Chat</span>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                Default: address all · Use <code style={{ background: C.accentBg, padding: '1px 6px', borderRadius: 4 }}>@firstname</code> to target one
              </span>
            </div>

            <div
              ref={scrollRef}
              onScroll={onScrollContainer}
              style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}
            >
              {messages.length === 0 && (
                <p style={{ color: C.textMuted, fontStyle: 'italic', marginTop: 16 }}>
                  Open the meeting. Say what's on the agenda.
                </p>
              )}
              {messages.map((m) => (
                <MeetingBubble key={m.id} m={m} />
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: '8px 24px 18px' }}>
              <div
                style={{
                  background: C.panelBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: '8px 8px 8px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  boxShadow: C.cardShadow,
                }}
              >
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send();
                    }
                  }}
                  placeholder="Open the discussion… (Enter to send, @firstname to direct)"
                  rows={1}
                  disabled={streaming || participants.length === 0}
                  style={{
                    flex: 1,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: C.text,
                    fontFamily: SANS,
                    fontSize: 15,
                    resize: 'none',
                    padding: '6px 0',
                    minHeight: 24,
                    maxHeight: 140,
                  }}
                />
                <button
                  onClick={() => void send()}
                  disabled={streaming || !draft.trim() || participants.length === 0}
                  style={{
                    background:
                      streaming || !draft.trim() ? C.hairline : C.accentBg,
                    border: 'none',
                    borderRadius: 8,
                    width: 40,
                    height: 40,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: streaming || !draft.trim() ? 'not-allowed' : 'pointer',
                    color: C.accentText,
                  }}
                  aria-label="Send"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Header ──────────────────────────────────────────────────

function Header({
  subject,
  participantCount,
  elapsed,
  onEnd,
}: {
  subject: string;
  participantCount: number;
  elapsed: number;
  onEnd: () => void;
}) {
  const formatted = formatElapsed(elapsed);
  return (
    <div
      style={{
        padding: '18px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${C.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: C.accentBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: C.accentText,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>Board Meeting</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginTop: 2 }}>{subject}</div>
        </div>
        <div
          style={{
            background: C.badgeBg,
            color: C.badgeText,
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: 999,
            marginLeft: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.badgeText, display: 'inline-block' }} />
          In Progress
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginLeft: 8 }}>
          {participantCount} participants
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Time Elapsed
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {formatted}
          </div>
        </div>
        <button
          onClick={onEnd}
          style={{
            background: '#fff',
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: '10px 16px',
            cursor: 'pointer',
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 600,
            color: '#c0392b',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ display: 'inline-block', width: 18, height: 18, lineHeight: '18px', textAlign: 'center', background: '#c0392b', color: '#fff', borderRadius: 4 }}>×</span>
          End Meeting
        </button>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ── Participants panel (right side of top half) ─────────────

function ParticipantsPanel({ participants }: { participants: VPSummary[] }) {
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        background: C.shellBg,
        borderLeft: `1px solid ${C.border}`,
        padding: 16,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        Participants <span style={{ color: C.textMuted, fontWeight: 400 }}>({participants.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ParticipantRow name="You" role="CEO" badge="Leading" />
        {participants.map((p) => (
          <ParticipantRow
            key={p.id}
            name={p.name}
            role={p.role}
            palette={p.palette}
            hueShift={getHueShiftForVp(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantRow({
  name,
  role,
  badge,
  palette,
  hueShift = 0,
}: {
  name: string;
  role: string;
  badge?: string;
  palette?: number;
  hueShift?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 8px',
        borderRadius: 8,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: '#d9c8a8',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          border: `1px solid ${C.border}`,
        }}
      >
        {palette !== undefined ? (
          <div style={{ width: 28, height: 32, marginBottom: -4 }}>
            <CharacterPortrait
              palette={palette}
              hueShift={hueShift}
              scale={3}
              background="transparent"
            />
          </div>
        ) : (
          <span style={{ fontSize: 14, color: C.textMuted, marginBottom: 8 }}>👤</span>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
          {name}
          {badge && (
            <span style={{ fontSize: 10, background: C.accentBg, color: C.accentText, padding: '2px 6px', borderRadius: 999, fontWeight: 600 }}>
              {badge}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted }}>{role}</div>
      </div>
    </div>
  );
}

// ── Chat bubble ─────────────────────────────────────────────

function MeetingBubble({ m }: { m: MeetingMessage }) {
  const time = m.ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (m.who === 'you') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <div
          style={{
            maxWidth: '75%',
            background: C.accentBg,
            borderRadius: 14,
            padding: '10px 14px',
            color: C.text,
            fontSize: 14,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: C.accentText, marginBottom: 4 }}>You</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.text}</div>
          <div style={{ fontSize: 10, color: C.textMuted, textAlign: 'right', marginTop: 4 }}>{time}</div>
        </div>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-end' }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#d9c8a8',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          border: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        {m.vpPalette !== undefined && (
          <div style={{ width: 26, height: 28, marginBottom: -4 }}>
            <CharacterPortrait
              palette={m.vpPalette}
              hueShift={m.vpHueShift ?? 0}
              scale={3}
              background="transparent"
            />
          </div>
        )}
      </div>
      <div
        style={{
          maxWidth: '75%',
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: '10px 14px',
          color: C.text,
          fontSize: 14,
          boxShadow: C.cardShadow,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
          {m.vpName}
          {m.vpRole && (
            <span style={{ color: C.textMuted, fontWeight: 400, marginLeft: 6 }}>
              {m.vpRole}
            </span>
          )}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {m.text}
          {m.pending && <span style={{ color: C.textMuted }}> …</span>}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>{time}</div>
      </div>
    </div>
  );
}
