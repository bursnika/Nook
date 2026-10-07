-- Trigram indexes make `ILIKE '%text%'` fast on very large tables (autocomplete over millions of users).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);
