-- CreateEnum
CREATE TYPE "TitleStatus" AS ENUM ('draft', 'processing', 'published', 'failed');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('source', 'mezzanine', 'shot', 'narration');

-- CreateEnum
CREATE TYPE "RenditionKind" AS ENUM ('audio_main', 'audio_ad');

-- CreateEnum
CREATE TYPE "TextKind" AS ENUM ('captions', 'sdh', 'descriptions');

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER,
    "license" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION,
    "posterKey" TEXT,
    "heroKey" TEXT,
    "synopsis" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "voice" TEXT NOT NULL DEFAULT 'Joanna',
    "status" "TitleStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "s3Key" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "bytes" INTEGER,
    "durationS" DOUBLE PRECISION,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shot" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "description" TEXT,
    "sameAsPrev" BOOLEAN NOT NULL DEFAULT false,
    "novaTokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Shot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gap" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,

    CONSTRAINT "Gap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DescriptionCue" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "extended" BOOLEAN NOT NULL DEFAULT false,
    "pollyKey" TEXT,
    "wordCount" INTEGER NOT NULL,

    CONSTRAINT "DescriptionCue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rendition" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "kind" "RenditionKind" NOT NULL,
    "language" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,

    CONSTRAINT "Rendition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextTrack" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "kind" "TextKind" NOT NULL,
    "language" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "cueCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TextTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "adDefault" BOOLEAN NOT NULL DEFAULT true,
    "extendedMode" BOOLEAN NOT NULL DEFAULT true,
    "voice" TEXT NOT NULL DEFAULT 'Joanna',
    "captionKind" TEXT NOT NULL DEFAULT 'sdh',
    "captionScale" INTEGER NOT NULL DEFAULT 100,
    "firstRunDone" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Progress" (
    "profileId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "positionS" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Progress_pkey" PRIMARY KEY ("profileId","titleId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Title_slug_key" ON "Title"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Shot_titleId_index_key" ON "Shot"("titleId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_deviceId_key" ON "Profile"("deviceId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shot" ADD CONSTRAINT "Shot_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gap" ADD CONSTRAINT "Gap_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DescriptionCue" ADD CONSTRAINT "DescriptionCue_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendition" ADD CONSTRAINT "Rendition_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextTrack" ADD CONSTRAINT "TextTrack_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Progress" ADD CONSTRAINT "Progress_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE CASCADE ON UPDATE CASCADE;
