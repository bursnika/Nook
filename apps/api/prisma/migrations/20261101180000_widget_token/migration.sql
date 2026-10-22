-- AlterTable
ALTER TABLE "User" ADD COLUMN     "widgetTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_widgetTokenHash_key" ON "User"("widgetTokenHash");

