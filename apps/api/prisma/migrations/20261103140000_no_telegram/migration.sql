DROP TABLE "TelegramLink";
DROP INDEX "Task_dueDate_reminderSentAt_idx";
ALTER TABLE "Task" DROP COLUMN "reminderSentAt";
