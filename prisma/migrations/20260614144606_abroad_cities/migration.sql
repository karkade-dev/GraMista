-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'UA';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "abroadCities" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "abroadHideAggressor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "abroadTopMode" TEXT NOT NULL DEFAULT 'separate',
ADD COLUMN     "abroadWorldMap" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Settlement_country_idx" ON "Settlement"("country");
