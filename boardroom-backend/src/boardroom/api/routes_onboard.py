"""Template gallery + onboarding wizard for adding new VPs.

  GET   /vp_templates                            — list gallery
  GET   /vp_templates/{id}                       — one template + question list
  POST  /vps/onboard                             — start a session, returns 1st question
  POST  /vps/onboard/{session_id}/answer         — submit an answer, returns next or preview
  POST  /vps/onboard/{session_id}/commit         — finalize: write the VP row + starter facts

Session state is in-process. Sessions older than 30 minutes are evicted on
next call; if the server restarts mid-wizard the user starts over. Acceptable
tradeoff for a single-user local app — we can move to Redis if multi-user
arrives.
"""

from __future__ import annotations

import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from boardroom.api.deps import get_store_dep
from boardroom.persistence import Store
from boardroom.persistence.store import VPRecord, VPTemplate

router = APIRouter()


# ── Template gallery ─────────────────────────────────────────


class TemplateSummary(BaseModel):
    id: str
    category: str
    display_name: str
    description: str


class TemplateQuestion(BaseModel):
    id: str
    prompt: str
    hint: str
    field: str


class TemplateDetail(TemplateSummary):
    questions: list[TemplateQuestion]


@router.get("/vp_templates", response_model=list[TemplateSummary])
def list_templates(store: Store = Depends(get_store_dep)) -> list[TemplateSummary]:
    return [
        TemplateSummary(
            id=t.id,
            category=t.category,
            display_name=t.display_name,
            description=t.description,
        )
        for t in store.list_vp_templates()
    ]


@router.get("/vp_templates/{template_id}", response_model=TemplateDetail)
def get_template(template_id: str, store: Store = Depends(get_store_dep)) -> TemplateDetail:
    t = store.get_vp_template(template_id)
    if t is None:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")
    return TemplateDetail(
        id=t.id,
        category=t.category,
        display_name=t.display_name,
        description=t.description,
        questions=[TemplateQuestion(**q) for q in t.questions],
    )


# ── Wizard session state ─────────────────────────────────────


_SESSION_TTL_SECONDS = 30 * 60


@dataclass
class _Session:
    session_id: str
    template_id: str
    palette: int
    answers: dict[str, str] = field(default_factory=dict)
    created_at: float = field(default_factory=time.time)


_sessions: dict[str, _Session] = {}


def _evict_stale() -> None:
    cutoff = time.time() - _SESSION_TTL_SECONDS
    stale = [sid for sid, s in _sessions.items() if s.created_at < cutoff]
    for sid in stale:
        _sessions.pop(sid, None)


def _get_session(session_id: str) -> _Session:
    _evict_stale()
    sess = _sessions.get(session_id)
    if sess is None:
        raise HTTPException(
            status_code=404,
            detail="Onboarding session not found or expired. Start a new one.",
        )
    return sess


# ── Wizard endpoints ─────────────────────────────────────────


class OnboardStart(BaseModel):
    template_id: str
    palette: int = 0


class OnboardQuestionOut(BaseModel):
    session_id: str
    question: TemplateQuestion | None
    answered: int
    total: int
    preview: "VPPreview | None" = None


class VPPreview(BaseModel):
    """What the new VP will look like once committed. Shown in the wizard."""

    suggested_id: str
    name: str
    role: str
    description: str
    persona_body: str
    objectives: dict[str, Any]
    core_facts: list[str]
    palette: int
    template_id: str


OnboardQuestionOut.model_rebuild()


@router.post("/vps/onboard", response_model=OnboardQuestionOut)
def onboard_start(
    req: OnboardStart,
    store: Store = Depends(get_store_dep),
) -> OnboardQuestionOut:
    template = store.get_vp_template(req.template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"Template not found: {req.template_id}")
    if not 0 <= req.palette <= 5:
        raise HTTPException(status_code=400, detail="palette must be 0-5")

    sess = _Session(
        session_id=str(uuid.uuid4()),
        template_id=req.template_id,
        palette=req.palette,
    )
    _sessions[sess.session_id] = sess
    return _build_question_out(sess, template)


class OnboardAnswer(BaseModel):
    question_id: str
    answer: str


@router.post("/vps/onboard/{session_id}/answer", response_model=OnboardQuestionOut)
def onboard_answer(
    session_id: str,
    req: OnboardAnswer,
    store: Store = Depends(get_store_dep),
) -> OnboardQuestionOut:
    sess = _get_session(session_id)
    template = store.get_vp_template(sess.template_id)
    if template is None:
        raise HTTPException(status_code=500, detail="Template missing — session invalid")

    valid_ids = {q["id"] for q in template.questions}
    if req.question_id not in valid_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown question_id '{req.question_id}' for this template",
        )
    sess.answers[req.question_id] = req.answer.strip()
    return _build_question_out(sess, template)


@router.post("/vps/onboard/{session_id}/commit", response_model=VPPreview)
def onboard_commit(
    session_id: str,
    store: Store = Depends(get_store_dep),
) -> VPPreview:
    sess = _get_session(session_id)
    template = store.get_vp_template(sess.template_id)
    if template is None:
        raise HTTPException(status_code=500, detail="Template missing — session invalid")

    # Validate all required questions answered (allow empty for blank template)
    missing = [
        q["id"] for q in template.questions if not sess.answers.get(q["id"], "").strip()
    ]
    if missing and template.id != "blank":
        raise HTTPException(
            status_code=400,
            detail=f"Missing answers for questions: {missing}",
        )

    preview = _render_preview(template, sess.answers, sess.palette)

    # Refuse to overwrite an existing VP id (rare collision; user should rename)
    if store.get_vp(preview.suggested_id) is not None:
        # Append a short suffix
        suffix = uuid.uuid4().hex[:6]
        preview.suggested_id = f"{preview.suggested_id}_{suffix}"

    # Write the VP row
    from datetime import datetime, timezone

    placeholder = datetime.fromtimestamp(0, tz=timezone.utc)
    store.upsert_vp(
        VPRecord(
            id=preview.suggested_id,
            name=preview.name,
            role=preview.role,
            description=preview.description,
            persona_body=preview.persona_body,
            objectives=preview.objectives,
            tools={},
            palette=preview.palette,
            template_id=template.id,
            archived_at=None,
            created_at=placeholder,
            updated_at=placeholder,
        )
    )
    # Write starter core_facts
    for fact in preview.core_facts:
        if fact.strip():
            store.add_core_fact(preview.suggested_id, fact)

    # Done with the session
    _sessions.pop(session_id, None)
    return preview


# ── Helpers ──────────────────────────────────────────────────


def _build_question_out(sess: _Session, template: VPTemplate) -> OnboardQuestionOut:
    """Return the next unanswered question, or a preview if all are done."""
    answered = len(sess.answers)
    total = len(template.questions)

    next_q = next(
        (q for q in template.questions if q["id"] not in sess.answers),
        None,
    )
    if next_q is not None:
        return OnboardQuestionOut(
            session_id=sess.session_id,
            question=TemplateQuestion(**next_q),
            answered=answered,
            total=total,
        )

    # All answered — include a preview
    preview = _render_preview(template, sess.answers, sess.palette)
    return OnboardQuestionOut(
        session_id=sess.session_id,
        question=None,
        answered=answered,
        total=total,
        preview=preview,
    )


_PLACEHOLDER_RE = re.compile(r"\{\{(\w+)\}\}")


def _slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    return s.strip("_") or "vp"


def _fill(template_text: str, answers: dict[str, str]) -> str:
    return _PLACEHOLDER_RE.sub(lambda m: answers.get(m.group(1), ""), template_text)


def _render_preview(
    template: VPTemplate,
    answers: dict[str, str],
    palette: int,
) -> VPPreview:
    name = answers.get("name") or "(Unnamed VP)"
    persona_body = _fill(template.base_persona, answers).strip()

    objectives: dict[str, Any] = {}
    for k, v in template.base_objectives.items():
        if isinstance(v, str):
            objectives[k] = _fill(v, answers)
        else:
            objectives[k] = v

    core_facts = [_fill(f, answers).strip() for f in template.base_core_facts]
    core_facts = [f for f in core_facts if f and f not in ("Always: ", "Never: ")]

    # Extract role from template's base_persona ("# Name — Role" pattern); fallback
    # to the template's display_name minus suffix
    role_match = re.search(r"^#\s+[^—]+—\s+(.+?)$", persona_body, re.MULTILINE)
    role = role_match.group(1).strip() if role_match else template.display_name

    # Short description: take the first sentence of the Identity section
    desc_match = re.search(
        r"^##\s+Identity\s*\n+(.+?)(?=\n##\s+|\Z)",
        persona_body,
        re.DOTALL | re.MULTILINE,
    )
    description = ""
    if desc_match:
        para = desc_match.group(1).strip().split("\n\n", 1)[0]
        description = re.sub(r"\s+", " ", para).strip()

    return VPPreview(
        suggested_id=_slugify(name),
        name=name,
        role=role,
        description=description,
        persona_body=persona_body,
        objectives=objectives,
        core_facts=core_facts,
        palette=palette,
        template_id=template.id,
    )
