/**
 * Boardroom backend API client.
 *
 * Talks to the FastAPI service at BOARDROOM_BASE (default http://127.0.0.1:8100).
 * All methods throw on non-2xx responses.
 *
 * The streaming chat helper uses fetch + ReadableStream (rather than EventSource)
 * because EventSource doesn't support POST or custom headers. Same protocol
 * (text/event-stream), just hand-parsed.
 */

const BOARDROOM_BASE =
  (import.meta.env?.VITE_BOARDROOM_BASE as string | undefined) ??
  'http://127.0.0.1:8100';

// ── Types ───────────────────────────────────────────────────

export type MemoryType = 'preference' | 'fact' | 'relationship' | 'pattern';
export type TargetScope = 'individual' | 'board';

export interface VPSummary {
  id: string;
  name: string;
  role: string;
  description: string;
  palette: number;
}

export interface CoreFact {
  id: string;
  content: string;
  created_at: string;
}

export interface VPProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  persona_body: string;
  objectives: Record<string, unknown>;
  tools: Record<string, unknown>;
  palette: number;
  template_id: string | null;
  core_facts: CoreFact[];
  memory_count: number;
  directive_count: number;
}

export interface DirectiveRow {
  id: string;
  directive: string;
  response: string;
  target_scope: TargetScope;
  created_at: string;
}

export interface MemoryRow {
  id: string;
  memory_type: MemoryType;
  content: string;
  source_directive_id: string | null;
  created_at: string;
}

export interface TemplateSummary {
  id: string;
  category: string;
  display_name: string;
  description: string;
}

export interface TemplateQuestion {
  id: string;
  prompt: string;
  hint: string;
  field: string;
}

export interface TemplateDetail extends TemplateSummary {
  questions: TemplateQuestion[];
}

export interface VPPreview {
  suggested_id: string;
  name: string;
  role: string;
  description: string;
  persona_body: string;
  objectives: Record<string, unknown>;
  core_facts: string[];
  palette: number;
  template_id: string;
}

export interface OnboardQuestionOut {
  session_id: string;
  question: TemplateQuestion | null;
  answered: number;
  total: number;
  preview: VPPreview | null;
}

// ── Low-level helpers ───────────────────────────────────────

async function jfetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BOARDROOM_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      // Ignore parse error; use statusText
    }
    throw new Error(`${res.status} ${detail}`);
  }
  // 204 No Content — return undefined cast
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── VP read ─────────────────────────────────────────────────

export function listVPs(): Promise<VPSummary[]> {
  return jfetch<VPSummary[]>('/vps');
}

export function getVP(vpId: string): Promise<VPProfile> {
  return jfetch<VPProfile>(`/vp/${encodeURIComponent(vpId)}`);
}

export function getVPHistory(vpId: string, limit = 20): Promise<DirectiveRow[]> {
  return jfetch<DirectiveRow[]>(
    `/vp/${encodeURIComponent(vpId)}/history?limit=${limit}`,
  );
}

export function getVPMemories(
  vpId: string,
  opts: { type?: MemoryType; limit?: number } = {},
): Promise<MemoryRow[]> {
  const params = new URLSearchParams();
  if (opts.type) params.set('type', opts.type);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return jfetch<MemoryRow[]>(
    `/vp/${encodeURIComponent(vpId)}/memories${qs ? `?${qs}` : ''}`,
  );
}

// ── VP write ────────────────────────────────────────────────

export function pinCoreFact(vpId: string, content: string): Promise<CoreFact> {
  return jfetch<CoreFact>(`/vp/${encodeURIComponent(vpId)}/core_facts`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function unpinCoreFact(vpId: string, factId: string): Promise<void> {
  return jfetch<void>(
    `/vp/${encodeURIComponent(vpId)}/core_facts/${encodeURIComponent(factId)}`,
    { method: 'DELETE' },
  );
}

export interface VPPatch {
  name?: string;
  role?: string;
  description?: string;
  persona_body?: string;
  objectives?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  palette?: number;
}

export function patchVP(vpId: string, patch: VPPatch): Promise<VPProfile> {
  return jfetch<VPProfile>(`/vp/${encodeURIComponent(vpId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function archiveVP(vpId: string): Promise<void> {
  return jfetch<void>(`/vp/${encodeURIComponent(vpId)}`, { method: 'DELETE' });
}

// ── Templates / onboarding wizard ───────────────────────────

export function listTemplates(): Promise<TemplateSummary[]> {
  return jfetch<TemplateSummary[]>('/vp_templates');
}

export function getTemplate(templateId: string): Promise<TemplateDetail> {
  return jfetch<TemplateDetail>(
    `/vp_templates/${encodeURIComponent(templateId)}`,
  );
}

export function startOnboarding(
  templateId: string,
  palette: number,
): Promise<OnboardQuestionOut> {
  return jfetch<OnboardQuestionOut>('/vps/onboard', {
    method: 'POST',
    body: JSON.stringify({ template_id: templateId, palette }),
  });
}

export function answerOnboarding(
  sessionId: string,
  questionId: string,
  answer: string,
): Promise<OnboardQuestionOut> {
  return jfetch<OnboardQuestionOut>(
    `/vps/onboard/${encodeURIComponent(sessionId)}/answer`,
    {
      method: 'POST',
      body: JSON.stringify({ question_id: questionId, answer }),
    },
  );
}

export function commitOnboarding(sessionId: string): Promise<VPPreview> {
  return jfetch<VPPreview>(
    `/vps/onboard/${encodeURIComponent(sessionId)}/commit`,
    { method: 'POST' },
  );
}

// ── Streaming chat (SSE) ────────────────────────────────────

export interface ChatStreamEvents {
  onMeta?: (directiveId: string) => void;
  onToken?: (text: string) => void;
  onWarn?: (message: string) => void;
  onError?: (message: string) => void;
  onDone?: (directiveId: string) => void;
  signal?: AbortSignal;
}

/**
 * POST /vp/{id}/chat as a streaming SSE consumer. Resolves when the stream
 * closes; rejects on HTTP error.
 */
export async function streamChat(
  vpId: string,
  text: string,
  ev: ChatStreamEvents,
): Promise<void> {
  const res = await fetch(
    `${BOARDROOM_BASE}/vp/${encodeURIComponent(vpId)}/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ev.signal,
    },
  );
  if (!res.ok || !res.body) {
    throw new Error(`chat failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line (\n\n)
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      _dispatchSSE(raw, ev);
    }
  }
  // Flush any trailing event without blank line (rare)
  if (buf.trim()) _dispatchSSE(buf, ev);
}

function _dispatchSSE(raw: string, ev: ChatStreamEvents): void {
  // Parse "event: X\ndata: Y" pairs
  let eventName = 'message';
  let dataStr = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataStr = line.slice(5).trim();
  }
  if (!dataStr) return;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr) as Record<string, unknown>;
  } catch {
    return;
  }

  switch (eventName) {
    case 'meta':
      ev.onMeta?.(String(data.directive_id ?? ''));
      break;
    case 'token':
      ev.onToken?.(String(data.text ?? ''));
      break;
    case 'warn':
      ev.onWarn?.(String(data.message ?? ''));
      break;
    case 'error':
      ev.onError?.(String(data.message ?? ''));
      break;
    case 'done':
      ev.onDone?.(String(data.directive_id ?? ''));
      break;
  }
}
