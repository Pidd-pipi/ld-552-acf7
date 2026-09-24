import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import { JobStatus, UserRole } from '../../constants/enums';

const transitions: Record<JobStatus, JobStatus[]> = {
  [JobStatus.DRAFT]: [JobStatus.OPEN],
  [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED],
  [JobStatus.PAUSED]: [JobStatus.CLOSED, JobStatus.OPEN],
  // 岗位关闭后不能重新开放，仅允许归档
  [JobStatus.CLOSED]: [JobStatus.ARCHIVED],
  [JobStatus.ARCHIVED]: [],
};
@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}
  async findAll(query: any, user: any) {
    const where: any = { status: query.status, department: query.department };
    if (user.role === UserRole.HIRING_MANAGER) where.department = user.department;
    return this.prisma.job.findMany({ where, include: { hiringManager: { select: publicUserSelect }, _count: { select: { resumes: true, offers: true } } }, orderBy: { updatedAt: 'desc' } });
  }
  findOne(id: number) { return this.prisma.job.findUnique({ where: { id }, include: { hiringManager: { select: publicUserSelect }, resumes: { include: { candidate: true, interviews: true } }, offers: { include: { candidate: true, approver: { select: publicUserSelect } } } } }); }
  create(data: any) { return this.prisma.job.create({ data: { ...data, headcount: data.headcount != null ? Number(data.headcount) : data.headcount, status: data.status || JobStatus.DRAFT } }); }

  async update(id: number, data: any) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');

    // 状态只能通过专门的状态机接口流转，避免绕过“关闭后不能重新开放”等规则
    const { status, ...patch } = data;
    if (status && status !== job.status) {
      throw new BadRequestException('职位状态请通过状态变更接口修改');
    }

    // 招聘人数不得低于已录用人数
    if (patch.headcount != null && Number(patch.headcount) < job.hiredCount) {
      throw new BadRequestException(`招聘人数不能低于已录用人数（当前已录用 ${job.hiredCount} 人）`);
    }
    if (patch.headcount != null) patch.headcount = Number(patch.headcount);

    return this.prisma.job.update({ where: { id }, data: patch });
  }

  async updateStatus(id: number, status: JobStatus, reason?: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (!transitions[job.status as JobStatus].includes(status)) {
      const hint = job.status === JobStatus.CLOSED && status === JobStatus.OPEN
        ? '岗位关闭后不能重新开放，仅可归档'
        : `Invalid Job status transition: ${job.status} -> ${status}`;
      throw new BadRequestException(hint);
    }
    const updated = await this.prisma.job.update({ where: { id }, data: { status } });
    return { ...updated, beforeStatus: job.status, reason };
  }
  resumes(id: number) { return this.prisma.resume.findMany({ where: { jobId: id }, include: { candidate: true, interviews: true } }); }
  interviews(id: number) { return this.prisma.interview.findMany({ where: { resume: { jobId: id } }, include: { resume: { include: { candidate: true } }, interviewer: { select: publicUserSelect } } }); }
}
