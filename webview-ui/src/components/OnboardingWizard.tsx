/**
 * Onboarding wizard for adding a new VP.
 *
 * Four steps:
 *   1. Pick a template from the gallery
 *   2. Pick a sprite palette (0-5)
 *   3. Answer ~6 questions one-by-one
 *   4. Preview the assembled VP, commit on confirm
 */

import { useCallback, useEffect, useState } from 'react';

import {
  type OnboardQuestionOut,
  type TemplateSummary,
  type VPPreview,
  answerOnboarding,
  commitOnboarding,
  listTemplates,
  startOnboarding,
} from '../services/boardroom.js';
import { Button } from './ui/Button.js';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCommitted: (preview: VPPreview) => void;
}

type Stage = 'template' | 'palette' | 'questions' | 'preview' | 'committing' | 'done';

export function OnboardingWizard({ isOpen, onClose, onCommitted }: Props) {
  const [stage, setStage] = useState<Stage>('template');
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [chosenTemplate, setChosenTemplate] = useState<TemplateSummary | null>(null);
  const [palette, setPalette] = useState(0);
  const [session, setSession] = useState<OnboardQuestionOut | null>(null);
  const [draftAnswer, setDraftAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset when opened
  useEffect(() => {
    if (!isOpen) return;
    setStage('template');
    setChosenTemplate(null);
    setPalette(0);
    setSession(null);
    setDraftAnswer('');
    setError(null);
    listTemplates()
      .then(setTemplates)
      .catch((e: unknown) => setError(String(e)));
  }, [isOpen]);

  const closeAndReset = useCallback(() => {
    onClose();
  }, [onClose]);

  const beginQuestions = useCallback(async () => {
    if (!chosenTemplate) return;
    setError(null);
    try {
      const out = await startOnboarding(chosenTemplate.id, palette);
      setSession(out);
      setDraftAnswer('');
      setStage(out.question ? 'questions' : 'preview');
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [chosenTemplate, palette]);

  const submitAnswer = useCallback(async () => {
    if (!session?.question) return;
    if (!draftAnswer.trim()) return;
    setError(null);
    try {
      const next = await answerOnboarding(
        session.session_id,
        session.question.id,
        draftAnswer.trim(),
      );
      setSession(next);
      setDraftAnswer('');
      if (!next.question) setStage('preview');
    } catch (e: unknown) {
      setError(String(e));
    }
  }, [session, draftAnswer]);

  const commit = useCallback(async () => {
    if (!session) return;
    setError(null);
    setStage('committing');
    try {
      const preview = await commitOnboarding(session.session_id);
      onCommitted(preview);
      setStage('done');
    } catch (e: unknown) {
      setError(String(e));
      setStage('preview');
    }
  }, [session, onCommitted]);

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-black/70"
        style={{ zIndex: 70 }}
        onClick={closeAndReset}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-bg border-2 border-border rounded-none shadow-pixel flex flex-col"
        style={{ zIndex: 71, width: '720px', maxWidth: '95vw', maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between py-4 px-10 border-b border-border">
          <span className="text-accent-bright text-2xl">Add a new VP</span>
          <Button variant="ghost" size="icon" onClick={closeAndReset}>
            x
          </Button>
        </div>

        {/* Stage indicator */}
        <div className="border-b border-border py-2 px-10 text-xs text-text-muted uppercase tracking-wider">
          {stageLabel(stage, session)}
        </div>

        <div className="flex-1 overflow-y-auto p-10">
          {error && (
            <p className="text-red-400 text-sm mb-4">Error: {error}</p>
          )}

          {stage === 'template' && (
            <TemplateGallery
              templates={templates}
              onPick={(t) => {
                setChosenTemplate(t);
                setStage('palette');
              }}
            />
          )}

          {stage === 'palette' && chosenTemplate && (
            <PaletteStep
              template={chosenTemplate}
              palette={palette}
              onPalette={setPalette}
              onBack={() => setStage('template')}
              onNext={() => void beginQuestions()}
            />
          )}

          {stage === 'questions' && session?.question && (
            <QuestionStep
              session={session}
              draft={draftAnswer}
              onDraft={setDraftAnswer}
              onSubmit={() => void submitAnswer()}
            />
          )}

          {stage === 'preview' && session?.preview && (
            <PreviewStep
              preview={session.preview}
              onBack={() => setStage('questions')}
              onCommit={() => void commit()}
            />
          )}

          {stage === 'committing' && (
            <p className="text-text-muted">Adding the new VP to the office…</p>
          )}

          {stage === 'done' && session?.preview && (
            <DoneStep preview={session.preview} onClose={closeAndReset} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Stage helpers ───────────────────────────────────────────

function stageLabel(stage: Stage, session: OnboardQuestionOut | null): string {
  switch (stage) {
    case 'template':
      return 'Step 1 — Pick a template';
    case 'palette':
      return 'Step 2 — Pick a sprite';
    case 'questions':
      return session?.question
        ? `Step 3 — Question ${session.answered + 1} of ${session.total}`
        : 'Step 3 — Questions';
    case 'preview':
      return 'Step 4 — Preview & commit';
    case 'committing':
      return 'Committing…';
    case 'done':
      return 'Done';
  }
}

// ── Template gallery ────────────────────────────────────────

function TemplateGallery({
  templates,
  onPick,
}: {
  templates: TemplateSummary[] | null;
  onPick: (t: TemplateSummary) => void;
}) {
  if (!templates) return <p className="text-text-muted">Loading templates…</p>;
  return (
    <div className="grid grid-cols-2 gap-4">
      {templates.map((t) => (
        <button
          key={t.id}
          onClick={() => onPick(t)}
          className="text-left border-2 border-border bg-active-bg/30 hover:border-accent rounded-none p-4 cursor-pointer"
        >
          <div className="text-accent-bright text-base mb-1">
            {t.display_name}
          </div>
          <div className="text-xs text-text-muted uppercase mb-2">
            {t.category}
          </div>
          <div className="text-sm">{t.description}</div>
        </button>
      ))}
    </div>
  );
}

// ── Palette step ────────────────────────────────────────────

function PaletteStep({
  template,
  palette,
  onPalette,
  onBack,
  onNext,
}: {
  template: TemplateSummary;
  palette: number;
  onPalette: (p: number) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-text-muted mb-4">
        Template: <span className="text-text">{template.display_name}</span>
      </p>
      <p className="text-sm mb-4">Pick a sprite palette for this VP:</p>
      <div className="flex gap-3 mb-8 flex-wrap">
        {[0, 1, 2, 3, 4, 5].map((p) => (
          <button
            key={p}
            onClick={() => onPalette(p)}
            className={
              'w-16 h-16 border-4 flex items-center justify-center text-lg cursor-pointer ' +
              (palette === p
                ? 'border-accent bg-active-bg text-accent-bright'
                : 'border-border bg-bg text-text-muted hover:border-accent')
            }
          >
            {p}
          </button>
        ))}
      </div>
      <p className="text-xs text-text-muted mb-6">
        Each palette = one of the 6 stock character skins (char_0.png …
        char_5.png). The character will appear with this skin in the office.
      </p>
      <div className="flex gap-2">
        <Button variant="default" size="md" onClick={onBack}>
          Back
        </Button>
        <Button variant="accent" size="md" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

// ── Question step ───────────────────────────────────────────

function QuestionStep({
  session,
  draft,
  onDraft,
  onSubmit,
}: {
  session: OnboardQuestionOut;
  draft: string;
  onDraft: (s: string) => void;
  onSubmit: () => void;
}) {
  const q = session.question!;
  return (
    <div>
      <p className="text-accent-bright text-lg mb-2">{q.prompt}</p>
      {q.hint && <p className="text-xs text-text-muted mb-4">{q.hint}</p>}
      <textarea
        autoFocus
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={4}
        placeholder="Your answer… (⌘/Ctrl+Enter to submit)"
        className="w-full bg-bg text-text border-2 border-border rounded-none p-3 font-sans text-sm resize-y focus:border-accent focus:outline-none"
      />
      <div className="flex justify-between items-center mt-4">
        <span className="text-xs text-text-muted">
          Progress: {session.answered + 1}/{session.total}
        </span>
        <Button
          variant="accent"
          size="md"
          onClick={onSubmit}
          disabled={!draft.trim()}
        >
          {session.answered + 1 === session.total ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>
  );
}

// ── Preview step ────────────────────────────────────────────

function PreviewStep({
  preview,
  onBack,
  onCommit,
}: {
  preview: VPPreview;
  onBack: () => void;
  onCommit: () => void;
}) {
  return (
    <div>
      <p className="text-sm text-text-muted mb-4">
        Review the assembled VP. Commit to add them to the office.
      </p>
      <div className="border border-border p-4 bg-active-bg/30 mb-6">
        <div className="mb-3">
          <span className="text-accent-bright text-xl">{preview.name}</span>
          <span className="text-text-muted text-sm ml-3">{preview.role}</span>
        </div>
        <p className="text-sm italic text-text-muted mb-4">
          {preview.description}
        </p>
        <p className="text-xs text-text-muted">
          Suggested id:{' '}
          <code className="text-text">{preview.suggested_id}</code> · Sprite
          palette {preview.palette}
        </p>
      </div>

      <details className="mb-6">
        <summary className="cursor-pointer text-sm text-accent mb-2">
          Persona body
        </summary>
        <pre className="text-xs whitespace-pre-wrap font-mono border border-border p-3">
          {preview.persona_body}
        </pre>
      </details>

      <details className="mb-6">
        <summary className="cursor-pointer text-sm text-accent mb-2">
          Starter core facts
        </summary>
        <ul className="m-0 pl-8 list-disc">
          {preview.core_facts.map((f, i) => (
            <li key={i} className="text-sm mb-2">
              {f}
            </li>
          ))}
        </ul>
      </details>

      <div className="flex gap-2">
        <Button variant="default" size="md" onClick={onBack}>
          Back
        </Button>
        <Button variant="accent" size="md" onClick={onCommit}>
          Commit — add to office
        </Button>
      </div>
    </div>
  );
}

// ── Done step ───────────────────────────────────────────────

function DoneStep({
  preview,
  onClose,
}: {
  preview: VPPreview;
  onClose: () => void;
}) {
  return (
    <div className="text-center py-10">
      <p className="text-accent-bright text-xl mb-2">
        {preview.name} has joined the office.
      </p>
      <p className="text-text-muted text-sm mb-8">
        Look for the new character — sprite palette {preview.palette}. Click to
        chat.
      </p>
      <Button variant="accent" size="lg" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}
