-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googleId" TEXT;

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workspaceId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "minPlan" "Plan" NOT NULL DEFAULT 'PRO',
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_workspaceId_idx" ON "Invitation"("workspaceId");

-- CreateIndex
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Features gated by plan (task B6). Rows live in the migration so every environment has them.
INSERT INTO "FeatureFlag" ("key", "description", "minPlan", "enabled") VALUES
  ('insights', 'Insights page with productivity statistics', 'PRO', true),
  ('google-two-way-sync', 'Two-way Google Calendar synchronisation', 'PRO', true),
  ('ai-assistant', 'AI planning assistant', 'PRO', true)
ON CONFLICT ("key") DO NOTHING;
