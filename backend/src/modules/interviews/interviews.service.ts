import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import { InterviewResult, ResumeStatus, UserRole } from '../../constants/enums';
@Injectable()
export class InterviewsService {
  constructor(private prisma: PrismaService) {}
  findAll(q: any, req: any) {
    const where: any = { interviewerId: req.dataScope?.interviewerId, scheduledAt: {} };
    if (q.startDate) where.scheduledAt.gte = new Date(q.startDate);
    if (q.endDate) where.scheduledAt.lte = new Date(q.endDate);
    if (q.interviewerId && req.user.role !== UserRole.INTERVIEWER) where.interviewerId = Number(q.interviewerId);
    if (!Object.keys(where.scheduledAt).length) delete where.scheduledAt;
    return this.prisma.interview.findMany({ where, include: { resume: { include: { candidate: true, job: true } }, interviewer: { select: publicUserSelect } }, orderBy: { scheduledAt: 'asc' } });
  }
  async create(data: any) {
    const interview = await this.prisma.interview.create({ data: { ...data, scheduledAt: new Date(data.scheduledAt), result: InterviewResult.PENDING }, include: { resume: true } });
    // 安排面试自动进入面试阶段；已入职/已拒绝等终态简历不回退（保护录用名额事务结果）
    const resume = await this.prisma.resume.findUnique({ where: { id: data.resumeId } });
    if (resume && ![ResumeStatus.HIRED, ResumeStatus.REJECTED, ResumeStatus.OFFERED].includes(resume.status as ResumeStatus)) {
      await this.prisma.resume.update({ where: { id: data.resumeId }, data: { status: ResumeStatus.INTERVIEWING } });
    }
    return interview;
  }
  async update(id: number, data: any) {
    const current = await this.prisma.interview.findUnique({ where: { id }, include: { resume: true } });
    if (!current) throw new NotFoundException('Interview not found');
    const updated = await this.prisma.interview.update({ where: { id }, data: { ...data, scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined }, include: { resume: true, interviewer: { select: publicUserSelect } } });
    return { ...updated, beforeStatus: current.result, candidateId: current.resume.candidateId };
  }
}
