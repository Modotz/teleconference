-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadedFile_filename_key" ON "UploadedFile"("filename");

-- CreateIndex
CREATE INDEX "UploadedFile_uploaderId_idx" ON "UploadedFile"("uploaderId");

-- CreateIndex
CREATE INDEX "DirectMessage_attachmentUrl_idx" ON "DirectMessage"("attachmentUrl");

-- CreateIndex
CREATE INDEX "Message_attachmentUrl_idx" ON "Message"("attachmentUrl");
