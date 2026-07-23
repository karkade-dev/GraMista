-- AlterTable
ALTER TABLE "SettlementAlias" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "SettlementAlias_userId_idx" ON "SettlementAlias"("userId");

-- AddForeignKey
ALTER TABLE "SettlementAlias" ADD CONSTRAINT "SettlementAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
