-- CreateTable
CREATE TABLE "PageOp" (
    "seq" SERIAL NOT NULL,
    "pageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "ops" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageOp_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "PageOp_pageId_seq_idx" ON "PageOp"("pageId", "seq");

-- AddForeignKey
ALTER TABLE "PageOp" ADD CONSTRAINT "PageOp_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

