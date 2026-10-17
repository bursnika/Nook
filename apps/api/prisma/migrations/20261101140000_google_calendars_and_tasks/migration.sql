-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "calendarName" TEXT,
ADD COLUMN     "googleCalendarId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "googleTaskId" TEXT,
ADD COLUMN     "importedById" TEXT;

-- CreateIndex
CREATE INDEX "Task_importedById_idx" ON "Task"("importedById");

-- CreateIndex
CREATE UNIQUE INDEX "Task_workspaceId_googleTaskId_key" ON "Task"("workspaceId", "googleTaskId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

