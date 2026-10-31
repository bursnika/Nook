-- Plans are gone: every feature is available to everyone while its flag is on.
ALTER TABLE "Workspace" DROP COLUMN "plan";
ALTER TABLE "FeatureFlag" DROP COLUMN "minPlan";
DROP TYPE "Plan";

-- The AI assistant was removed.
DELETE FROM "FeatureFlag" WHERE "key" = 'ai-assistant';
