-- Email verification + password reset fields.
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "verifyToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "resetTokenExp" TIMESTAMP(3);

-- Existing accounts are considered verified so they aren't locked out.
UPDATE "User" SET "emailVerified" = true;
