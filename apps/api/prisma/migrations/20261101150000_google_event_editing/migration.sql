-- AlterTable
ALTER TABLE "CalendarEvent" ADD COLUMN     "googleEditable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleUrl" TEXT,
ADD COLUMN     "recurring" BOOLEAN NOT NULL DEFAULT false;

