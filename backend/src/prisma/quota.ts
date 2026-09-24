import { PrismaService } from './prisma.service';

/**
 * 录用名额计算：已录用人数 = 该岗位下 ACCEPTED 的 Offer 数。
 * 剩余名额 = headcount - 已录用人数。
 */
export async function getHiredCount(prisma: PrismaService, jobId: number): Promise<number> {
  return prisma.offer.count({ where: { jobId, status: 'ACCEPTED' } });
}

export async function getQuota(prisma: PrismaService, job: { id: number; headcount: number }) {
  const hiredCount = await getHiredCount(prisma, job.id);
  return { hiredCount, remainingSlots: job.headcount - hiredCount };
}

/** 批量附加名额信息，避免列表 N+1。 */
export async function withQuota<T extends { id: number; headcount: number }>(
  prisma: PrismaService,
  jobs: T[],
): Promise<(T & { hiredCount: number; remainingSlots: number })[]> {
  if (!jobs.length) return [];
  const grouped = await prisma.offer.groupBy({
    by: ['jobId'],
    where: { jobId: { in: jobs.map((j) => j.id) }, status: 'ACCEPTED' },
    _count: { _all: true },
  });
  const hiredMap = new Map(grouped.map((g) => [g.jobId, g._count._all]));
  return jobs.map((j) => {
    const hiredCount = hiredMap.get(j.id) ?? 0;
    return { ...j, hiredCount, remainingSlots: j.headcount - hiredCount };
  });
}
