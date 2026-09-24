import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import { getQuota, withQuota } from '../../prisma/quota';
import { JobStatus, UserRole } from '../../constants/enums';

const transitions: Record<JobStatus, JobStatus[]> = {
  [JobStatus.DRAFT]: [JobStatus.OPEN],
  [JobStatus.OPEN]: [JobStatus.PAUSED, JobStatus.CLOSED],
  [JobStatus.PAUSED]: [JobStatus.CLOSED, JobStatus.OPEN],
  // 关闭后的岗位不能重新开放（可能因名额招满自动关闭），仅可归档
  [JobStatus.CLOSED]: [JobStatus.ARCHIVED],
  [JobStatus.ARCHIVED]: [],
};
@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}
  async findAll(query: any, user: any) {
    const where: any = { status: query.status, department: query.department };
    if (user.role === UserRole.HIRING_MANAGER) where.department = user.department;
    const jobs = await this.prisma.job.findMany({ where, include: { hiringManager: { select: publicUserSelect }, _count: { select: { resumes: true, offers: true } } }, orderBy: { updatedAt: 'desc' } });
    return withQuota(this.prisma, jobs);
  }
  async findOne(id: number) {
    const job = await this.prisma.job.findUnique({ where: { id }, include: { hiringManager: { select: publicUserSelect }, resumes: { include: { candidate: true, interviews: true } }, offers: { include: { candidate: true, approver: { select: publicUserSelect } }, orderBy: { updatedAt: 'desc' } } } });
    if (!job) throw new NotFoundException('Job not found');
    const quota = await getQuota(this.prisma, job);
    return { ...job, ...quota };
  }
  create(data: any) { return this.prisma.job.create({ data: { ...data, status: data.status || JobStatus.DRAFT } }); }

  /**
   * 编辑岗位信息。
   * - 状态不允许由此接口直接改写，必须走状态机 PATCH /jobs/:id/status；
   * - headcount 不得低于已录用（ACCEPTED Offer）人数，避免名额与实际入职人数矛盾。
   */
  async update(id: number, data: any) {
    const { status, ...fields } = data || {};
    if (status) throw new BadRequestException('岗位状态变更请使用状态流转接口 PATCH /jobs/:id/status');
    if (fields.headcount !== undefined) {
      const headcount = Number(fields.headcount);
      if (!Number.isInteger(headcount) || headcount <= 0) throw new BadRequestException('招聘人数必须为正整数');
      const job = await this.prisma.job.findUnique({ where: { id } });
      if (!job) throw new NotFoundException('Job not found');
      const hiredCount = await this.prisma.offer.count({ where: { jobId: id, status: 'ACCEPTED' } });
      if (headcount < hiredCount) {
        throw new BadRequestException(`招聘人数不能低于已录用人数：当前已录用 ${hiredCount} 人，不能修改为 ${headcount}`);
      }
    }
    return this.prisma.job.update({ where: { id }, data: fields });
  }
  async updateStatus(id: number, status: JobStatus, reason?: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (status === JobStatus.OPEN && job.status === JobStatus.CLOSED) {
      throw new BadRequestException('岗位关闭后不能重新开放（名额招满自动关闭的岗位仅可归档）');
    }
    if (!transitions[job.status as JobStatus].includes(status)) throw new BadRequestException(`Invalid Job status transition: ${job.status} -> ${status}`);
    const updated = await this.prisma.job.update({ where: { id }, data: { status } });
    return { ...updated, beforeStatus: job.status, reason };
  }
  resumes(id: number) { return this.prisma.resume.findMany({ where: { jobId: id }, include: { candidate: true, interviews: true } }); }
  interviews(id: number) { return this.prisma.interview.findMany({ where: { resume: { jobId: id } }, include: { resume: { include: { candidate: true } }, interviewer: { select: publicUserSelect } } }); }
}
