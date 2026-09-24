-- AlterTable
ALTER TABLE "Job" ADD COLUMN "hiredCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN "resumeId" INTEGER,
ADD COLUMN "failReason" TEXT;

-- 已录用名额回填：以已接受（ACCEPTED）的 Offer 数量为准
UPDATE "Job" j SET "hiredCount" = (
    SELECT COUNT(*) FROM "Offer" o
    WHERE o."jobId" = j.id AND o."status" = 'ACCEPTED'
);

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 同一候选人对同一职位只允许存在一份未结束的 Offer（DRAFT/APPROVED/SENT）
CREATE UNIQUE INDEX "offer_active_candidate_job_unique" ON "Offer" ("candidateId", "jobId")
WHERE "status" IN ('DRAFT', 'APPROVED', 'SENT');
