import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 1.0;
export const WANDER_PAUSE_MAX_SEC = 45.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 2;
export const WANDER_MOVES_BEFORE_REST_MAX = 8;
export const SEAT_REST_MIN_SEC = 60.0;
export const SEAT_REST_MAX_SEC = 300.0;
/** Probability that an idle wanderer picks a free hangout seat as their next destination
 *  instead of a random walkable tile. Higher = more sitting, less wandering. */
export const HANGOUT_SIT_PROBABILITY = 0.3;
/** How long (seconds) a wanderer sits at a hangout seat before getting up to wander again. */
export const HANGOUT_SIT_MIN_SEC = 3.0;
export const HANGOUT_SIT_MAX_SEC = 60.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
/** Multiplier on the per-character sprite render zoom so characters appear
 *  larger than 1 logical tile. Needed when the office is a large background
 *  image and 16px characters would otherwise look like ants. Multiplies the
 *  sprite scale only — position/pathfinding still operate on tile coordinates. */
export const CHARACTER_RENDER_SCALE = 2;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const WALL_EDIT_OVERLAY_COLOR = 'rgba(220, 40, 60, 0.45)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
// Lower default zoom so the 64×48 background-image office fits more of the screen.
// User can still zoom in via the +/- controls.
export const ZOOM_DEFAULT_DPR_FACTOR = 1;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
/** Default/fallback palette count (bundled characters). Actual count comes from getLoadedCharacterCount(). */
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 16;
export const CHARACTER_HIT_HEIGHT = 48;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;

// ── Agent Teams ─────────────────────────────────────────────
export const MAX_CONTEXT_TOKENS = 200_000;
export const TOKEN_WARN_THRESHOLD = 0.6;
export const TOKEN_DANGER_THRESHOLD = 0.8;
export const TOKEN_CRITICAL_THRESHOLD = 0.95;
export const FUEL_GAUGE_WIDTH_PX = 40;
export const FUEL_GAUGE_HEIGHT_PX = 4;
export const FUEL_COLOR_OK = '#44cc44';
export const FUEL_COLOR_WARN = '#ffcc00';
export const FUEL_COLOR_DANGER = '#ff8800';
export const FUEL_COLOR_CRITICAL = '#ff2222';
export const FUEL_GAUGE_BG = '#222';
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── VP Overlay / Boardroom UI ──────────────────────────────
// Shared cream-themed color palette used by VP overlays, board meeting,
// meeting selector, and gathering indicator. Exempt from no-inline-colors.

/** Sans-serif font stack for VP overlays (chat-legible, not pixel-art) */
export const VP_SANS_FONT =
  '"FS Pixel Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

/** Base cream-themed color palette shared across VP overlay components */
export const VP_COLORS = {
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

/** Extended color palette for the VPOverlay (1:1 chat panel) */
export const VP_OVERLAY_COLORS = {
  ...VP_COLORS,
  accent: '#d97847',
  online: '#22a06b',
  userBubble: '#f3ebd9',
  vpBubble: '#ffffff',
  vpBubbleBorder: '#eadfc9',
  roleBadgeBg: '#f3ebd9',
  roleBadgeText: '#7a5a3a',
  buttonBg: '#fefaf2',
  buttonHover: '#f3ebd9',
};

/** Extended color palette for the BoardMeetingOverlay (group meeting) */
export const BOARD_MEETING_COLORS = {
  ...VP_COLORS,
  badgeBg: '#dceedd',
  badgeText: '#22a06b',
};

/** Avatar circle background used in VP portraits and chat bubbles */
export const VP_AVATAR_BG = '#d9c8a8';

/** Scrim backdrop for VP overlay modals */
export const VP_SCRIM = 'rgba(20, 14, 6, 0.55)';
export const VP_SCRIM_DARK = 'rgba(20, 14, 6, 0.65)';
export const VP_SCRIM_MEETING = 'rgba(20, 14, 6, 0.6)';

/** Error text color used across VP overlay components */
export const VP_ERROR_COLOR = '#c0392b';

/** "In Progress" task accent */
export const VP_TASK_IN_PROGRESS_COLOR = '#f4a52b';

/** End meeting button colors */
export const VP_END_MEETING_COLOR = '#c0392b';
export const VP_END_MEETING_BTN_BG = '#fff';
export const VP_END_MEETING_ICON_FG = '#fff';

// ── Character Portrait ─────────────────────────────────────
export const PORTRAIT_DEFAULT_BG =
  'linear-gradient(to bottom, #d9c8a8 0%, #d9c8a8 60%, #8b6f47 60%, #8b6f47 100%)';
export const PORTRAIT_RUG_COLOR = '#3a2e1f';
export const PORTRAIT_RUG_SHADOW = 'inset 0 0 0 4px #2a1f12';

// ── Conference Scene (canvas drawing colors) ───────────────
export const CONF_WALL_DARK = '#3a2e1f';
export const CONF_WALL_LIGHT = '#5a4631';
export const CONF_BOOKSHELF_COLOR = '#2a1e10';
export const CONF_WINDOW_BG = '#1a2a3e';
export const CONF_CITY_SILHOUETTE = '#0a1420';
export const CONF_WINDOW_GLOW = 'rgba(255, 220, 160, 0.06)';
export const CONF_SCREEN_BG = '#f5efe2';
export const CONF_SCREEN_TITLE = '#7a5a3a';
export const CONF_SCREEN_SUBTITLE = '#5a4631';
export const CONF_FLOOR_TOP = '#6b4f33';
export const CONF_FLOOR_BOTTOM = '#4a3520';
export const CONF_PLANK_LINE = 'rgba(0, 0, 0, 0.15)';
export const CONF_TABLE_TOP = '#6e4f31';
export const CONF_TABLE_BOTTOM = '#3a2515';
export const CONF_TABLE_HIGHLIGHT = 'rgba(255, 220, 160, 0.15)';
export const CONF_NO_PARTICIPANTS = '#bba07a';
export const CONF_CHAIR_COLOR = '#2a1e10';
export const CONF_PLACEHOLDER_COLOR = '#d9c8a8';
export const CONF_CONTAINER_BG = '#3a2e1f';
export const CONF_CONTAINER_SHADOW = 'inset 0 0 0 1px rgba(0, 0, 0, 0.1)';
export const CONF_LABEL_BG = '#ffffff';
export const CONF_LABEL_BORDER = '#eadfc9';
export const CONF_LABEL_SHADOW = '0 2px 6px rgba(0, 0, 0, 0.2)';
export const CONF_LABEL_TEXT = '#2a2a2a';
export const CONF_LABEL_ROLE_COLOR = '#7a7367';
export const CONF_SHELF_LINE = 'rgba(0, 0, 0, 0.3)';
export const CONF_BOOK_COLORS = ['#5a3a25', '#8b6b3a', '#c08a4e', '#6d4520'];
