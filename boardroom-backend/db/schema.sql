-- Boardroom schema for plain PostgreSQL (Neon). Ported from the Supabase
-- baseline (supabase/migrations/20260930175557_hosted_baseline.sql) minus
-- Supabase-only roles, grants, vault and realtime publication.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS vps (
    id text PRIMARY KEY,
    name text NOT NULL,
    role text NOT NULL,
    description text NOT NULL DEFAULT '',
    persona_body text NOT NULL DEFAULT '',
    objectives jsonb NOT NULL DEFAULT '{}'::jsonb,
    tools jsonb NOT NULL DEFAULT '{}'::jsonb,
    palette integer NOT NULL DEFAULT 0,
    template_id text,
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vp_templates (
    id text PRIMARY KEY,
    category text NOT NULL,
    display_name text NOT NULL,
    description text NOT NULL,
    questions jsonb NOT NULL DEFAULT '[]'::jsonb,
    base_persona text NOT NULL DEFAULT '',
    base_objectives jsonb NOT NULL DEFAULT '{}'::jsonb,
    base_core_facts jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS core_facts (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vp_id text NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
    content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS directive_history (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vp_id text NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
    directive text NOT NULL,
    response text NOT NULL,
    target_scope text NOT NULL DEFAULT 'individual',
    created_at timestamptz NOT NULL DEFAULT now(),
    fts tsvector GENERATED ALWAYS AS (
        to_tsvector('english'::regconfig, coalesce(directive, '') || ' ' || coalesce(response, ''))
    ) STORED
);

CREATE TABLE IF NOT EXISTS memories (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    vp_id text NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
    memory_type text NOT NULL,
    content text NOT NULL,
    source_directive_id text REFERENCES directive_history(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_core_facts_vp ON core_facts (vp_id, created_at);
CREATE INDEX IF NOT EXISTS idx_directive_history_fts ON directive_history USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_directive_history_vp ON directive_history (vp_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_vp ON memories (vp_id, created_at DESC);

CREATE OR REPLACE FUNCTION update_vps_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER vps_updated_at
    BEFORE UPDATE ON vps
    FOR EACH ROW EXECUTE FUNCTION update_vps_updated_at();

-- No policies: only the owning role (the backend) can read/write. Defense in
-- depth if Neon's Data API or another role is ever enabled.
ALTER TABLE vps ENABLE ROW LEVEL SECURITY;
ALTER TABLE vp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE core_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE directive_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
