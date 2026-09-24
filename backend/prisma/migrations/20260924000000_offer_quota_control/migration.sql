-- Offer 名额事务控制：失败原因、关联简历、并发保护索引

-- 接受录用失败（如争抢最后名额）的失败原因，成功接受后置空
ALTER TABLE "Offer" ADD COLUMN "failureReason" TEXT;

-- 关联到具体投递记录（同候选人同职位可能有多份历史简历）
ALTER TABLE "Offer" ADD COLUMN "resumeId" INTEGER;

-- 按职位统计已录用数量、按候选人+职位查询未结束 Offer 的索引
CREATE INDEX "Offer_jobId_status_idx" ON "Offer"("jobId", "status");
CREATE INDEX "Offer_candidateId_jobId_idx" ON "Offer"("candidateId", "jobId");

-- 同一候选人在同一职位只允许保留一份未结束（DRAFT/APPROVED/SENT）的 Offer。
-- 名额竞争场景下后端通过 Job 行锁串行化，此唯一索引作为最终防线防止并发重复创建。
CREATE UNIQUE INDEX "Offer_open_unique_candidate_job"
  ON "Offer"("candidateId", "jobId")
  WHERE "status" IN ('DRAFT', 'APPROVED', 'SENT');

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_resumeId_fkey"
  FOREIGN KEY ("resumeId") REFERENCES "Resume"("id") ON DELETE SET NULL ON UPDATE CASCADE;
