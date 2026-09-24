import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';

/** 为候选人的每份 Offer 附加其岗位剩余名额，供候选人页展示。 */
async function annotateOfferQuota(prisma: PrismaService, offers: any[]) {
  const jobIds = [...new Set(offers.map((o) => o.jobId))];
  if (!jobIds.length) return offers;
  const jobs = await prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, headcount: true } });
  const hiredGroups = await prisma.offer.groupBy({
    by: ['jobId'],
    where: { jobId: { in: jobIds }, status: 'ACCEPTED' },
    _count: { _all: true },
  });
  const headMap = new Map(jobs.map((j) => [j.id, j.headcount]));
  const hiredMap = new Map(hiredGroups.map((g) => [g.jobId, g._count._all]));
  return offers.map((o) => {
    const headcount = headMap.get(o.jobId);
    const hiredCount = hiredMap.get(o.jobId) ?? 0;
    return headcount === undefined ? o : { ...o, jobHiredCount: hiredCount, jobRemainingSlots: headcount - hiredCount };
  });
}

@Injectable()
export class CandidatesService {
  constructor(private prisma: PrismaService) {}
  findAll(q: any) {
    return this.prisma.candidate.findMany({ where: { source: q.source, OR: q.keyword ? [{ name: { contains: q.keyword, mode: 'insensitive' } }, { email: { contains: q.keyword, mode: 'insensitive' } }] : undefined, resumes: { some: { status: q.status, jobId: q.jobId ? Number(q.jobId) : undefined } } }, include: { resumes: { include: { job: true, interviews: true } }, offers: true }, orderBy: { updatedAt: 'desc' } });
  }
  async findOne(id: number) {
    const candidate = await this.prisma.candidate.findUnique({ where: { id }, include: { resumes: { include: { job: true, interviews: { include: { interviewer: { select: publicUserSelect } } } } }, offers: { include: { job: true, resume: true, approver: { select: publicUserSelect } }, orderBy: { updatedAt: 'desc' } } } });
    if (!candidate) return candidate;
    return { ...candidate, offers: await annotateOfferQuota(this.prisma, candidate.offers) };
  }
  resumes(id: number) { return this.prisma.resume.findMany({ where: { candidateId: id }, include: { job: true, interviews: true } }); }
  interviews(id: number) { return this.prisma.interview.findMany({ where: { resume: { candidateId: id } }, include: { resume: { include: { job: true } }, interviewer: { select: publicUserSelect } } }); }
  async offers(id: number) {
    const offers = await this.prisma.offer.findMany({ where: { candidateId: id }, include: { job: true, approver: { select: publicUserSelect } }, orderBy: { updatedAt: 'desc' } });
    return annotateOfferQuota(this.prisma, offers);
  }
}
