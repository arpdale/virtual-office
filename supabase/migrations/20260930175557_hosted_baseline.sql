-- Hosted schema snapshot; no personal data. Local restore baseline.



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."update_vps_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;


ALTER FUNCTION "public"."update_vps_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."core_facts" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "vp_id" "text" NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."core_facts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."directive_history" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "vp_id" "text" NOT NULL,
    "directive" "text" NOT NULL,
    "response" "text" NOT NULL,
    "target_scope" "text" DEFAULT 'individual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "fts" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", ((COALESCE("directive", ''::"text") || ' '::"text") || COALESCE("response", ''::"text")))) STORED
);


ALTER TABLE "public"."directive_history" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memories" (
    "id" "text" DEFAULT ("gen_random_uuid"())::"text" NOT NULL,
    "vp_id" "text" NOT NULL,
    "memory_type" "text" NOT NULL,
    "content" "text" NOT NULL,
    "source_directive_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."memories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vp_templates" (
    "id" "text" NOT NULL,
    "category" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "questions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "base_persona" "text" DEFAULT ''::"text" NOT NULL,
    "base_objectives" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "base_core_facts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL
);


ALTER TABLE "public"."vp_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vps" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "persona_body" "text" DEFAULT ''::"text" NOT NULL,
    "objectives" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "tools" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "palette" integer DEFAULT 0 NOT NULL,
    "template_id" "text",
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vps" OWNER TO "postgres";


ALTER TABLE ONLY "public"."core_facts"
    ADD CONSTRAINT "core_facts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."directive_history"
    ADD CONSTRAINT "directive_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vp_templates"
    ADD CONSTRAINT "vp_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vps"
    ADD CONSTRAINT "vps_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_core_facts_vp" ON "public"."core_facts" USING "btree" ("vp_id", "created_at");



CREATE INDEX "idx_directive_history_fts" ON "public"."directive_history" USING "gin" ("fts");



CREATE INDEX "idx_directive_history_vp" ON "public"."directive_history" USING "btree" ("vp_id", "created_at" DESC);



CREATE INDEX "idx_memories_vp" ON "public"."memories" USING "btree" ("vp_id", "created_at" DESC);



CREATE OR REPLACE TRIGGER "vps_updated_at" BEFORE UPDATE ON "public"."vps" FOR EACH ROW EXECUTE FUNCTION "public"."update_vps_updated_at"();



ALTER TABLE ONLY "public"."core_facts"
    ADD CONSTRAINT "core_facts_vp_id_fkey" FOREIGN KEY ("vp_id") REFERENCES "public"."vps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."directive_history"
    ADD CONSTRAINT "directive_history_vp_id_fkey" FOREIGN KEY ("vp_id") REFERENCES "public"."vps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_source_directive_id_fkey" FOREIGN KEY ("source_directive_id") REFERENCES "public"."directive_history"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."memories"
    ADD CONSTRAINT "memories_vp_id_fkey" FOREIGN KEY ("vp_id") REFERENCES "public"."vps"("id") ON DELETE CASCADE;



ALTER TABLE "public"."core_facts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."directive_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."memories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vp_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vps" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."update_vps_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_vps_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_vps_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."core_facts" TO "anon";
GRANT ALL ON TABLE "public"."core_facts" TO "authenticated";
GRANT ALL ON TABLE "public"."core_facts" TO "service_role";



GRANT ALL ON TABLE "public"."directive_history" TO "anon";
GRANT ALL ON TABLE "public"."directive_history" TO "authenticated";
GRANT ALL ON TABLE "public"."directive_history" TO "service_role";



GRANT ALL ON TABLE "public"."memories" TO "anon";
GRANT ALL ON TABLE "public"."memories" TO "authenticated";
GRANT ALL ON TABLE "public"."memories" TO "service_role";



GRANT ALL ON TABLE "public"."vp_templates" TO "anon";
GRANT ALL ON TABLE "public"."vp_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."vp_templates" TO "service_role";



GRANT ALL ON TABLE "public"."vps" TO "anon";
GRANT ALL ON TABLE "public"."vps" TO "authenticated";
GRANT ALL ON TABLE "public"."vps" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































-- Pin the trigger search path for the local instance.
ALTER FUNCTION public.update_vps_updated_at() SET search_path = '';
