-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_dueDate_reminderSentAt_idx" ON "Task"("dueDate", "reminderSentAt");

