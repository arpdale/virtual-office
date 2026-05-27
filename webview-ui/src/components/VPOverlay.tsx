/**
 * Full-screen overlay for one boardroom VP.
 *
 * Layout: cream-themed panel with three columns:
 *   - Left rail: icon-only tabs (Chat / Tasks / Activity / Profile)
 *   - Center: tab content. Chat is the default — name + role + Online +
 *     scrollable message list + input. Tasks shows the VP's kanban. Activity
 *     shows directive history. Profile shows persona + objectives + facts.
 *   - Right: large standing character portrait + "About {Name}" card +
 *     "View Tasks & Projects" button.
 *
 * Closes on Esc, click outside, or X.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CoreFact,
  type DirectiveRow,
  type MemoryRow,
  type MemoryType,
  type VPProfile,
  getVP,
  getVPHistory,
  getVPMemories,
  patchVP,
  pinCoreFact,
  streamChat,
  unpinCoreFact,
} from '../services/boardroom.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCharacterIdForVp, getHueShiftForVp, setVPActive } from '../office/boardroomRoster.js';
import { CharacterState } from '../office/types.js';
import { CharacterPortrait } from './CharacterPortrait.js';

type TabId = 'chat' | 'tasks' | 'activity' | 'profile';

interface Props {
  vpId: string;
  officeState: OfficeState;
  onClose: () => void;
  /** When false, overlay is hidden visually (kept mounted to preserve chat state) */
  visible?: boolean;
  /** Called by ChatTab to hide/show the overlay during the cinematic
   *  walk-to-desk transition between Enter and the streamed response. */
  onHide?: () => void;
  onShow?: () => void;
}

// ── Color palette ───────────────────────────────────────────
// Locked-in colors that match the mockup. Not driven by the dark theme.
const C = {
  shellBg: '#f8f1e3',       // outer cream
  panelBg: '#ffffff',       // inner card bg (left rail panel + about card)
  text: '#2a2a2a',
  textMuted: '#7a7367',
  border: '#eadfc9',
  hairline: '#eee8d8',
  accent: '#d97847',        // small accents
  online: '#22a06b',
  userBubble: '#f3ebd9',    // tan/cream filled (user messages)
  vpBubble: '#ffffff',      // white card (VP messages)
  vpBubbleBorder: '#eadfc9',
  roleBadgeBg: '#f3ebd9',
  roleBadgeText: '#7a5a3a',
  buttonBg: '#fefaf2',
  buttonHover: '#f3ebd9',
  shadow: '0 4px 24px rgba(60, 40, 10, 0.18)',
  cardShadow: '0 2px 12px rgba(60, 40, 10, 0.08)',
};

// Sans-serif stack so the overlay is readable. The app-wide default is a
// pixel-art font (FS Pixel Sans) which is great for tooltips but terrible
// for paragraphs of chat. We override it on the overlay only.
const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

export function VPOverlay({
  vpId,
  officeState,
  onClose,
  visible = true,
  onHide,
  onShow,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('chat');
  const [profile, setProfile] = useState<VPProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError(null);
    getVP(vpId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vpId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0"
        style={{
          background: 'rgba(20, 14, 6, 0.55)',
          zIndex: 60,
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transition: 'opacity 0.35s ease',
        }}
        onClick={onClose}
      />
      <div
        className="fixed flex vp-overlay-sans"
        style={{
          inset: '4vh 4vw',
          background: C.shellBg,
          borderRadius: 16,
          boxShadow: C.shadow,
          zIndex: 61,
          color: C.text,
          overflow: 'hidden',
          fontFamily: SANS,
          // Slightly larger base + relaxed line-height for chat legibility
          fontSize: 15,
          lineHeight: 1.5,
          letterSpacing: 'normal',
          opacity: visible ? 1 : 0,
          pointerEvents: visible ? 'auto' : 'none',
          transform: visible ? 'scale(1)' : 'scale(0.96)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (absolute, top-right) */}
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            zIndex: 5,
            width: 36,
            height: 36,
            borderRadius: 8,
            background: C.panelBg,
            border: `1px solid ${C.border}`,
            cursor: 'pointer',
            fontSize: 18,
            color: C.textMuted,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: C.cardShadow,
          }}
        >
          ×
        </button>

        {/* Left rail */}
        <LeftRail active={activeTab} onChange={setActiveTab} />

        {/* Center column */}
        <div className="flex-1 flex flex-col" style={{ minWidth: 0 }}>
          {error && (
            <div style={{ padding: 24, color: '#c0392b' }}>Error: {error}</div>
          )}
          {!profile && !error && (
            <div style={{ padding: 24, color: C.textMuted }}>Loading…</div>
          )}
          {profile && activeTab === 'chat' && (
            <ChatTab
              vp={profile}
              officeState={officeState}
              onHide={onHide}
              onShow={onShow}
            />
          )}
          {profile && activeTab === 'tasks' && <TasksTab vp={profile} />}
          {profile && activeTab === 'activity' && <ActivityTab vp={profile} />}
          {profile && activeTab === 'profile' && (
            <ProfileTab profile={profile} onSaved={setProfile} />
          )}
        </div>

        {/* Right column — portrait + about */}
        {profile && (
          <RightColumn
            profile={profile}
            onViewTasks={() => setActiveTab('tasks')}
          />
        )}
      </div>
    </>
  );
}

// ── Left rail ───────────────────────────────────────────────

function LeftRail({
  active,
  onChange,
}: {
  active: TabId;
  onChange: (t: TabId) => void;
}) {
  const items: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'chat', label: 'Chat', icon: <IconChat /> },
    { id: 'tasks', label: 'Tasks', icon: <IconTasks /> },
    { id: 'activity', label: 'Activity', icon: <IconActivity /> },
    { id: 'profile', label: 'Profile', icon: <IconProfile /> },
  ];
  return (
    <div
      style={{
        width: 92,
        flexShrink: 0,
        padding: '32px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        borderRight: `1px solid ${C.border}`,
      }}
    >
      {items.map((it) => {
        const isActive = active === it.id;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            style={{
              background: isActive ? C.userBubble : 'transparent',
              border: 'none',
              borderRadius: 12,
              padding: '12px 4px',
              cursor: 'pointer',
              color: isActive ? C.text : C.textMuted,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
            }}
          >
            <span style={{ opacity: isActive ? 1 : 0.7 }}>{it.icon}</span>
            <span style={{ fontWeight: isActive ? 600 : 400 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Right column: portrait + about ──────────────────────────

function RightColumn({
  profile,
  onViewTasks,
}: {
  profile: VPProfile;
  onViewTasks: () => void;
}) {
  // Pull a Location / Reports to / Focus from objectives if present
  const reportsTo = stringField(profile.objectives, 'reports_to');
  const focus = stringField(profile.objectives, 'focus') ?? profile.role;
  const location = stringField(profile.objectives, 'location') ?? 'Office';

  return (
    <div
      style={{
        width: '42%',
        flexShrink: 0,
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        background: C.shellBg,
        borderLeft: `1px solid ${C.border}`,
        minWidth: 360,
      }}
    >
      <div
        style={{
          flex: '1 1 60%',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#d9c8a8',
          boxShadow: C.cardShadow,
          minHeight: 280,
        }}
      >
        <CharacterPortrait
          palette={profile.palette}
          hueShift={getHueShiftForVp(profile.id)}
          scale={16}
        />
      </div>

      {/* About card */}
      <div
        style={{
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: 20,
          boxShadow: C.cardShadow,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 8 }}>
          About {firstName(profile.name)}
        </div>
        <p style={{ margin: 0, marginBottom: 14, color: C.textMuted, fontSize: 14, lineHeight: 1.5 }}>
          {profile.description || `${profile.name} is the ${profile.role}.`}
        </p>
        <div style={{ height: 1, background: C.hairline, marginBottom: 14 }} />
        <AboutRow icon={<IconRole />} label="Role" value={profile.role} />
        <AboutRow icon={<IconLocation />} label="Location" value={location} />
        {reportsTo && <AboutRow icon={<IconReports />} label="Reports to" value={reportsTo} />}
        <AboutRow icon={<IconFocus />} label="Focus" value={focus} />
      </div>

      {/* View tasks button */}
      <button
        onClick={onViewTasks}
        style={{
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 12,
          padding: '18px 20px',
          cursor: 'pointer',
          color: C.text,
          fontSize: 15,
          fontWeight: 500,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: C.cardShadow,
          fontFamily: 'inherit',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <IconTasks /> View Tasks & Projects
        </span>
        <span style={{ color: C.textMuted }}>›</span>
      </button>
    </div>
  );
}

function AboutRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 0',
        fontSize: 14,
      }}
    >
      <span style={{ color: C.textMuted, width: 18, display: 'flex' }}>{icon}</span>
      <span style={{ color: C.textMuted, width: 90, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.text }}>{value}</span>
    </div>
  );
}

// ── Chat tab ────────────────────────────────────────────────

interface ChatMessage {
  who: 'you' | 'vp';
  text: string;
  pending?: boolean;
  directiveId?: string;
  ts: Date;
}

/**
 * Wait until the VP's character has walked to their desk and sat down (FSM
 * state TYPE). Always waits at least `minMs` so the cinematic close-walk-
 * reopen is always visible (even if the character was already near their
 * seat). Times out after `maxMs` so a stuck pathfind never freezes the UI.
 */
async function waitUntilAtDesk(
  officeState: OfficeState,
  vpId: string,
  minMs = 1500,
  maxMs = 8000,
): Promise<void> {
  const charId = getCharacterIdForVp(vpId);
  if (charId === undefined) {
    // No mapping — just wait the minimum so user sees the cinematic gap.
    await new Promise((r) => setTimeout(r, minMs));
    return;
  }
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const ch = officeState.characters.get(charId);
      if (!ch) {
        // Character disappeared — still honor the min cinematic delay
        const elapsed = Date.now() - start;
        if (elapsed >= minMs) return resolve();
        return setTimeout(resolve, minMs - elapsed);
      }
      const elapsed = Date.now() - start;
      if (ch.state === CharacterState.TYPE && elapsed >= minMs) return resolve();
      if (elapsed > maxMs) return resolve();
      setTimeout(tick, 80);
    };
    tick();
  });
}

function ChatTab({
  vp,
  officeState,
  onHide,
  onShow,
}: {
  vp: VPProfile;
  officeState: OfficeState;
  onHide?: () => void;
  onShow?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Synchronous guard — `streaming` state has a stale-closure race window
  // between the user hitting Enter and React re-rendering the disabled
  // textarea, so we also gate on a ref that updates immediately.
  const sendingRef = useRef(false);

  // Load existing chat history when overlay opens for this VP, so the user
  // can re-open the overlay and see prior tasks/responses.
  useEffect(() => {
    let cancelled = false;
    getVPHistory(vp.id, 20)
      .then((rows) => {
        if (cancelled) return;
        const msgs: ChatMessage[] = [];
        // History comes newest-first; render oldest-first
        for (const r of [...rows].reverse()) {
          const ts = new Date(r.created_at);
          msgs.push({ who: 'you', text: r.directive, ts, directiveId: r.id });
          msgs.push({ who: 'vp', text: r.response, ts, directiveId: r.id });
        }
        setMessages(msgs);
      })
      .catch(() => {
        // history load failure is non-fatal — start with empty
      });
    return () => {
      cancelled = true;
    };
  }, [vp.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setError(null);
    setDraft('');
    setStreaming(true);

    setMessages((prev) => [
      ...prev,
      { who: 'you', text, ts: new Date() },
      { who: 'vp', text: '', pending: true, ts: new Date() },
    ]);

    // Cinematic flow:
    //   1) hide overlay
    //   2) flip VP active → walks to seat
    //   3) wait until they're at the desk (FSM state TYPE)
    //   4) show overlay back
    //   5) stream the response
    onHide?.();
    setVPActive(officeState, vp.id, true);
    await waitUntilAtDesk(officeState, vp.id);
    onShow?.();

    try {
      await streamChat(vp.id, text, {
        onMeta: (id) => {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const i = next.length - 1;
            next[i] = { ...next[i], directiveId: id };
            return next;
          });
        },
        onToken: (chunk) => {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const i = next.length - 1;
            next[i] = { ...next[i], text: (next[i].text ?? '') + chunk };
            return next;
          });
        },
        onError: (msg) => setError(msg),
        onDone: () => {
          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const next = [...prev];
            const i = next.length - 1;
            next[i] = { ...next[i], pending: false };
            return next;
          });
        },
      });
    } catch (e: unknown) {
      setError(String(e));
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        const i = next.length - 1;
        next[i] = { ...next[i], pending: false };
        return next;
      });
    } finally {
      sendingRef.current = false;
      setStreaming(false);
      // Stand up after the response is finished; the FSM stays at the desk
      // for a moment, then wanders.
      setVPActive(officeState, vp.id, false);
    }
  }, [draft, vp.id, officeState, onHide, onShow]);

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '28px 32px 12px 32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {vp.name}
          </h1>
          <span
            style={{
              background: C.roleBadgeBg,
              color: C.roleBadgeText,
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 999,
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            {abbrevRole(vp.role)}
          </span>
        </div>
        <p
          style={{
            margin: '6px 0 12px 0',
            color: C.textMuted,
            fontSize: 15,
            lineHeight: 1.4,
            maxWidth: 520,
          }}
        >
          {vp.description}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.online, fontSize: 14, fontWeight: 500 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: C.online,
              display: 'inline-block',
            }}
          />
          Online
        </div>
      </div>

      {/* Hairline + Today divider */}
      <div style={{ borderTop: `1px solid ${C.hairline}`, margin: '0 32px' }} />
      <div style={{ textAlign: 'center', color: C.textMuted, fontSize: 12, padding: '12px 0 4px 0' }}>
        Today
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '8px 32px 12px' }}>
        {messages.length === 0 && (
          <p style={{ color: C.textMuted, fontStyle: 'italic', textAlign: 'center', marginTop: 32 }}>
            Ask {firstName(vp.name)} something to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} m={m} vp={vp} />
        ))}
        {error && (
          <p style={{ color: '#c0392b', fontSize: 13 }}>Error: {error}</p>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '12px 32px 28px 32px' }}>
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
            placeholder={`Message ${firstName(vp.name)}…`}
            rows={1}
            disabled={streaming}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: C.text,
              fontFamily: 'inherit',
              fontSize: 15,
              resize: 'none',
              padding: '6px 0',
              minHeight: 24,
              maxHeight: 120,
            }}
          />
          <button
            onClick={() => void send()}
            disabled={streaming || !draft.trim()}
            style={{
              background: streaming || !draft.trim() ? C.hairline : C.roleBadgeBg,
              border: 'none',
              borderRadius: 8,
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: streaming || !draft.trim() ? 'not-allowed' : 'pointer',
              color: C.roleBadgeText,
              transition: 'background 0.15s',
            }}
            aria-label="Send"
          >
            <IconSend />
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m, vp }: { m: ChatMessage; vp: VPProfile }) {
  const time = m.ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (m.who === 'you') {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <div
          style={{
            maxWidth: '70%',
            background: C.userBubble,
            borderRadius: 14,
            padding: '12px 16px',
            color: C.text,
            fontSize: 14,
            lineHeight: 1.45,
          }}
        >
          <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'right', marginTop: 6 }}>
            {time}
          </div>
        </div>
      </div>
    );
  }
  // VP message
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'flex-end' }}>
      <AvatarBubble palette={vp.palette} hueShift={getHueShiftForVp(vp.id)} />
      <div
        style={{
          maxWidth: '70%',
          background: C.vpBubble,
          border: `1px solid ${C.vpBubbleBorder}`,
          borderRadius: 14,
          padding: '12px 16px',
          color: C.text,
          fontSize: 14,
          lineHeight: 1.45,
        }}
      >
        <div style={{ whiteSpace: 'pre-wrap' }}>
          {m.text}
          {m.pending && <span style={{ color: C.textMuted }}> …</span>}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{time}</div>
      </div>
    </div>
  );
}

function AvatarBubble({ palette, hueShift = 0 }: { palette: number; hueShift?: number }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: '#d9c8a8',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        border: `1px solid ${C.border}`,
      }}
    >
      <div style={{ width: 28, height: 32, marginBottom: -4 }}>
        <CharacterPortrait
          palette={palette}
          hueShift={hueShift}
          scale={3}
          background="transparent"
        />
      </div>
    </div>
  );
}

// ── Tasks tab ──────────────────────────────────────────────
// Every chat directive IS a task. Done tasks show the VP's response — click
// to expand. This gives a "view their work" surface separate from the
// scrollback in Chat.

function TasksTab({ vp }: { vp: VPProfile }) {
  const [rows, setRows] = useState<DirectiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getVPHistory(vp.id, 100)
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(String(e));
        });
    void load();
    // Refresh every 3s in case the user just sent a task in another tab.
    const id = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [vp.id]);

  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>Error: {error}</div>;
  if (!rows) return <div style={{ padding: 24, color: C.textMuted }}>Loading…</div>;

  // Bucket: "in progress" = directives that have no response stored yet
  // (extremely rare since the backend writes both at once); "done" = the rest.
  // We show all as "Completed" by default; quick visual grouping.
  const completed = rows.filter((d) => d.response && d.response.trim().length > 0);
  const inProgress = rows.filter((d) => !d.response || d.response.trim().length === 0);

  return (
    <div style={{ padding: 32, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginTop: 0, fontSize: 22, fontWeight: 600 }}>
        {firstName(vp.name)}'s Tasks
      </h2>
      <p style={{ color: C.textMuted, marginTop: 0, marginBottom: 24, fontSize: 14 }}>
        Anything you ask {firstName(vp.name)} in chat becomes a task. Click any completed task to see the work.
      </p>

      {rows.length === 0 && (
        <div
          style={{
            background: C.panelBg,
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
            padding: 32,
            textAlign: 'center',
            color: C.textMuted,
          }}
        >
          No tasks yet. Open the Chat tab and assign one.
        </div>
      )}

      {inProgress.length > 0 && (
        <TaskColumn
          label="In Progress"
          accent="#f4a52b"
          tasks={inProgress}
          expandedId={expandedId}
          onToggle={setExpandedId}
        />
      )}
      {completed.length > 0 && (
        <TaskColumn
          label="Completed"
          accent={C.online}
          tasks={completed}
          expandedId={expandedId}
          onToggle={setExpandedId}
        />
      )}
    </div>
  );
}

function TaskColumn({
  label,
  accent,
  tasks,
  expandedId,
  onToggle,
}: {
  label: string;
  accent: string;
  tasks: DirectiveRow[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: accent,
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
        <span style={{ fontSize: 13, color: C.textMuted }}>· {tasks.length}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            expanded={expandedId === t.id}
            onToggle={() => onToggle(expandedId === t.id ? null : t.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  expanded,
  onToggle,
}: {
  task: DirectiveRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ts = new Date(task.created_at);
  return (
    <div
      onClick={onToggle}
      style={{
        background: C.panelBg,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: 14,
        boxShadow: C.cardShadow,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            {truncate(task.directive, 120)}
          </div>
          <div style={{ fontSize: 12, color: C.textMuted }}>
            {ts.toLocaleString()}
          </div>
        </div>
        <span style={{ color: C.textMuted, fontSize: 18 }}>{expanded ? '−' : '+'}</span>
      </div>
      {expanded && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: `1px solid ${C.hairline}`,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            The Work
          </div>
          <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {task.response || <em style={{ color: C.textMuted }}>still working…</em>}
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ── Activity tab ────────────────────────────────────────────

function ActivityTab({ vp }: { vp: VPProfile }) {
  const [rows, setRows] = useState<DirectiveRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVPHistory(vp.id, 50)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [vp.id]);

  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>Error: {error}</div>;
  if (!rows) return <div style={{ padding: 24, color: C.textMuted }}>Loading…</div>;
  if (rows.length === 0)
    return (
      <div style={{ padding: 24, color: C.textMuted }}>
        No activity yet. Open the Chat tab and say hi.
      </div>
    );

  return (
    <div style={{ padding: 32, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginTop: 0, fontSize: 24 }}>Recent activity</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((d) => (
          <div
            key={d.id}
            style={{
              background: C.panelBg,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 16,
              boxShadow: C.cardShadow,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: C.textMuted }}>
                {new Date(d.created_at).toLocaleString()}
              </span>
              <span style={{ fontSize: 12, color: C.textMuted, textTransform: 'uppercase' }}>
                {d.target_scope}
              </span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.roleBadgeText, marginBottom: 4 }}>
              You said
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{d.directive}</p>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.online, marginBottom: 4 }}>
              {vp.name.split(' ')[0]} replied
            </div>
            <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{d.response}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Profile tab (editable) ──────────────────────────────────

const MEMORY_TYPES: MemoryType[] = ['preference', 'fact', 'relationship', 'pattern'];

function ProfileTab({
  profile,
  onSaved,
}: {
  profile: VPProfile;
  onSaved: (p: VPProfile) => void;
}) {
  const [personaDraft, setPersonaDraft] = useState(profile.persona_body);
  const [descDraft, setDescDraft] = useState(profile.description);
  const [objectivesDraft, setObjectivesDraft] = useState(
    JSON.stringify(profile.objectives, null, 2),
  );
  const [coreFactsView, setCoreFactsView] = useState<CoreFact[]>(profile.core_facts);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<MemoryRow[] | null>(null);

  useEffect(() => {
    setPersonaDraft(profile.persona_body);
    setDescDraft(profile.description);
    setObjectivesDraft(JSON.stringify(profile.objectives, null, 2));
    setCoreFactsView(profile.core_facts);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    getVPMemories(profile.id, { limit: 100 })
      .then((m) => {
        if (!cancelled) setMemories(m);
      })
      .catch(() => {
        if (!cancelled) setMemories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile.id]);

  const dirty =
    personaDraft !== profile.persona_body ||
    descDraft !== profile.description ||
    objectivesDraft !== JSON.stringify(profile.objectives, null, 2);

  const save = useCallback(async () => {
    setError(null);
    let objectives: Record<string, unknown>;
    try {
      objectives = JSON.parse(objectivesDraft) as Record<string, unknown>;
    } catch {
      setError('Objectives must be valid JSON.');
      return;
    }
    setSaving(true);
    try {
      const updated = await patchVP(profile.id, {
        persona_body: personaDraft,
        description: descDraft,
        objectives,
      });
      onSaved(updated);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [personaDraft, descDraft, objectivesDraft, profile.id, onSaved]);

  const onPinMemory = useCallback(
    async (mem: MemoryRow) => {
      try {
        await pinCoreFact(profile.id, mem.content);
        const fresh = await getVP(profile.id);
        onSaved(fresh);
        setCoreFactsView(fresh.core_facts);
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [profile.id, onSaved],
  );

  const onUnpin = useCallback(
    async (fact: CoreFact) => {
      try {
        await unpinCoreFact(profile.id, fact.id);
        setCoreFactsView((prev) => prev.filter((f) => f.id !== fact.id));
        const fresh = await getVP(profile.id);
        onSaved(fresh);
      } catch (e: unknown) {
        setError(String(e));
      }
    },
    [profile.id, onSaved],
  );

  const grouped = useMemo(() => {
    const out: Record<MemoryType, MemoryRow[]> = {
      preference: [],
      fact: [],
      relationship: [],
      pattern: [],
    };
    for (const m of memories ?? []) out[m.memory_type].push(m);
    return out;
  }, [memories]);

  return (
    <div style={{ padding: 32, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ marginTop: 0, fontSize: 24 }}>Profile</h2>

      <FieldGroup label="Hover blurb">
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          rows={2}
          style={inputStyle()}
        />
      </FieldGroup>

      <FieldGroup label="Persona (markdown)">
        <textarea
          value={personaDraft}
          onChange={(e) => setPersonaDraft(e.target.value)}
          rows={12}
          style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 12 }}
        />
      </FieldGroup>

      <FieldGroup label="Objectives (JSON)">
        <textarea
          value={objectivesDraft}
          onChange={(e) => setObjectivesDraft(e.target.value)}
          rows={8}
          style={{ ...inputStyle(), fontFamily: 'monospace', fontSize: 12 }}
        />
      </FieldGroup>

      <FieldGroup label="Core facts (always in prompt)">
        {coreFactsView.length === 0 ? (
          <p style={{ color: C.textMuted, fontSize: 13 }}>None yet — pin a memory below.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {coreFactsView.map((f) => (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  background: C.panelBg,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <span style={{ fontSize: 14 }}>{f.content}</span>
                <button onClick={() => void onUnpin(f)} style={ghostButtonStyle()}>
                  unpin
                </button>
              </div>
            ))}
          </div>
        )}
      </FieldGroup>

      <FieldGroup label="Extracted memories — pin any to core facts">
        {MEMORY_TYPES.map((t) => {
          const list = grouped[t];
          if (!list || list.length === 0) return null;
          return (
            <div key={t} style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: C.textMuted,
                  marginBottom: 6,
                }}
              >
                {t}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {list.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 10,
                      background: C.panelBg,
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      padding: '10px 14px',
                    }}
                  >
                    <span style={{ fontSize: 13 }}>{m.content}</span>
                    <button onClick={() => void onPinMemory(m)} style={ghostButtonStyle()}>
                      pin
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </FieldGroup>

      {error && <p style={{ color: '#c0392b', fontSize: 13 }}>Error: {error}</p>}

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: C.shellBg,
          padding: '12px 0',
          borderTop: `1px solid ${C.hairline}`,
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          style={{
            background: dirty ? C.roleBadgeBg : C.hairline,
            color: dirty ? C.roleBadgeText : C.textMuted,
            border: 'none',
            borderRadius: 10,
            padding: '10px 18px',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <span style={{ fontSize: 12, color: C.textMuted }}>
          {dirty ? 'Unsaved changes' : 'Up to date'}
        </span>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    background: C.panelBg,
    border: `1px solid ${C.border}`,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    color: C.text,
    resize: 'vertical',
  };
}

function ghostButtonStyle(): React.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    color: C.textMuted,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}

// ── Helpers ─────────────────────────────────────────────────

function firstName(full: string): string {
  return full.split(' ')[0] ?? full;
}

function abbrevRole(role: string): string {
  // "Chief Technology Officer" → "CTO", etc.
  const acronyms: Record<string, string> = {
    'Chief Technology Officer': 'CTO',
    'Chief Marketing Officer': 'CMO',
    'Chief Financial Officer': 'CFO',
    'Head of Sales': 'SALES',
    'Operations Lead': 'OPS',
    'Head of Design': 'DESIGN',
    'Head of People': 'PEOPLE',
  };
  return acronyms[role] ?? role.toUpperCase().slice(0, 8);
}

function stringField(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}

// ── Icons (inline SVG) ──────────────────────────────────────

function IconChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
    </svg>
  );
}

function IconTasks() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 11l3 3L22 4"/>
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
    </svg>
  );
}

function IconActivity() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}

function IconProfile() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}

function IconRole() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}

function IconLocation() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function IconReports() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}

function IconFocus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <circle cx="12" cy="12" r="6"/>
      <circle cx="12" cy="12" r="2"/>
    </svg>
  );
}
