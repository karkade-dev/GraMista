-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dockKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_dockKey_key" ON "User"("dockKey");
