/**
 * Pokemon-style cutscene indicator shown while VPs walk to the conference
 * table before the meeting overlay opens. Small floating pill at top center,
 * shows how many have arrived + a Skip button to jump straight to chat.
 */

interface Props {
  arrived: number;
  total: number;
  onSkip: () => void;
}

const SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

export function MeetingGatheringIndicator({ arrived, total, onSkip }: Props) {
  const pct = total === 0 ? 0 : Math.min(100, Math.round((arrived / total) * 100));
  return (
    <div
      className="vp-overlay-sans"
      style={{
        position: 'fixed',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 75,
        background: '#f8f1e3',
        border: '1px solid #eadfc9',
        boxShadow: '0 4px 24px rgba(60, 40, 10, 0.25)',
        borderRadius: 12,
        padding: '12px 18px 12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        fontFamily: SANS,
        color: '#2a2a2a',
        minWidth: 320,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#f3ebd9',
          color: '#7a5a3a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      >
        ⏳
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
          Gathering the board…
        </div>
        <div
          style={{
            position: 'relative',
            height: 4,
            borderRadius: 2,
            background: '#eadfc9',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${pct}%`,
              background: '#7a5a3a',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: '#7a7367', marginTop: 4 }}>
          {arrived} of {total} seated
        </div>
      </div>

      <button
        onClick={onSkip}
        style={{
          background: '#ffffff',
          border: '1px solid #eadfc9',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          color: '#2a2a2a',
          fontFamily: SANS,
        }}
      >
        Skip →
      </button>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}
