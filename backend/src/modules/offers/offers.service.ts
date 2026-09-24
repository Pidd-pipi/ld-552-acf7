import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import { JobStatus, OfferStatus, ResumeStatus } from '../../constants/enums';

const flow: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: ['APPROVED'] as OfferStatus[],
  APPROVED: ['SENT', 'REJECTED'] as OfferStatus[],
  SENT: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'] as OfferStatus[],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/** 尚未结束、仍占用名额竞争资格的 Offer 状态 */
const ACTIVE_STATUSES: OfferStatus[] = [OfferStatus.DRAFT, OfferStatus.APPROVED, OfferStatus.SENT];

const offerInclude = { candidate: true, job: true, resume: true, approver: { select: publicUserSelect } } as const;

@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}

  /**
   * 创建 Offer（事务）：
   * - 岗位必须为 OPEN（创建 Offer 时岗位应开放）
   * - 简历存在、归属该候选人与岗位，且处于 INTERVIEWING（面试阶段）
   * - 同一候选人在同一职位只保留一份未结束的 Offer
   */
  async create(data: any) {
    const candidateId = Number(data.candidateId);
    const jobId = Number(data.jobId);
    if (!candidateId || !jobId || data.salary == null || !data.startDate || !data.approverId) {
      throw new BadRequestException('缺少创建 Offer 所需字段：candidateId/jobId/salary/startDate/approverId');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 锁定岗位行，串行化同岗位的 Offer 创建/接受竞争
        const jobRows = await tx.$queryRaw<{ id: number; status: string; headcount: number }[]>`
          SELECT id, status, headcount FROM "Job" WHERE id = ${jobId} FOR UPDATE`;
        const job = jobRows[0];
        if (!job) throw new NotFoundException('岗位不存在');
        if (job.status !== JobStatus.OPEN) {
          throw new BadRequestException(`岗位当前为${job.status}状态，仅开放中的岗位可以创建 Offer`);
        }

        const resume = await tx.resume.findFirst({
          where: { candidateId, jobId, ...(data.resumeId ? { id: Number(data.resumeId) } : {}) },
        });
        if (!resume) throw new BadRequestException('该候选人在此岗位下没有投递记录，无法创建 Offer');
        if (resume.status !== ResumeStatus.INTERVIEWING) {
          throw new ConflictException(`简历当前为 ${resume.status} 状态，只有面试阶段（INTERVIEWING）的简历可以创建 Offer`);
        }

        const existing = await tx.offer.findFirst({
          where: { candidateId, jobId, status: { in: ACTIVE_STATUSES } },
        });
        if (existing) {
          throw new ConflictException(`该候选人在此岗位已有一份未结束的 Offer（#${existing.id}，${existing.status}），请先结束后再创建`);
        }

        const hiredCount = await tx.offer.count({ where: { jobId, status: OfferStatus.ACCEPTED } });
        if (hiredCount >= job.headcount) {
          throw new ConflictException(`岗位名额已满（招聘 ${job.headcount} 人，已录用 ${hiredCount} 人），无法再创建 Offer`);
        }

        return tx.offer.create({
          data: {
            candidateId,
            jobId,
            resumeId: resume.id,
            salary: new Prisma.Decimal(String(data.salary)),
            startDate: new Date(data.startDate),
            status: OfferStatus.DRAFT,
            approverId: Number(data.approverId),
          },
          include: offerInclude,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    } catch (e) {
      // 并发下唯一索引兜底冲突
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('该候选人在此岗位已有一份未结束的 Offer');
      }
      throw e;
    }
  }

  /**
   * Offer 状态流转（事务）：
   * - SENT → ACCEPTED：行锁锁定岗位后核对剩余名额，两人争抢最后一个名额时只有一人成功；
   *   成功者占用名额（ACCEPTED），简历转 HIRED；岗位满员后自动 CLOSED。
   * - APPROVED → SENT：简历推进到 OFFERED。
   * - SENT → REJECTED/WITHDRAWN：清空失败原因，简历从 OFFERED 退回 INTERVIEWING。
   * - 竞争失败等业务原因持久化到 failureReason，供岗位详情与候选人页展示。
   */
  async updateStatus(id: number, status: OfferStatus, reason?: string, actorId?: number) {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');
    if (!flow[offer.status as OfferStatus].includes(status)) {
      throw new BadRequestException(`Invalid Offer status transition: ${offer.status} -> ${status}`);
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: number; status: string; headcount: number }[]>`
          SELECT id, status, headcount FROM "Job" WHERE id = ${offer.jobId} FOR UPDATE`;
        const job = rows[0];
        if (!job) throw new NotFoundException('岗位不存在');

        if (status === OfferStatus.ACCEPTED) {
          // 先核对剩余名额：争抢最后名额的后来者应得到明确的名额不足原因
          const hiredCount = await tx.offer.count({ where: { jobId: offer.jobId, status: OfferStatus.ACCEPTED } });
          if (hiredCount >= job.headcount) {
            throw new ConflictException(
              `岗位剩余名额不足：招聘 ${job.headcount} 人，已录用 ${hiredCount} 人，接受录用失败`,
            );
          }
          if (job.status !== JobStatus.OPEN) {
            throw new ConflictException(`岗位已${job.status === JobStatus.CLOSED ? '关闭' : '暂停'}，无法接受 Offer`);
          }
        }

        // 重新读取，防止并发下 Offer 已被改动
        const fresh = await tx.offer.findUnique({ where: { id } });
        if (!fresh || !flow[fresh.status as OfferStatus].includes(status)) {
          throw new ConflictException(`Offer 状态已变更为 ${fresh?.status ?? '不存在'}，无法执行 ${status}`);
        }

        const result = await tx.offer.update({
          where: { id },
          data: {
            status,
            failureReason:
              status === OfferStatus.ACCEPTED
                ? null
                : [OfferStatus.REJECTED, OfferStatus.WITHDRAWN].includes(status)
                  ? null
                  : undefined,
          },
          include: offerInclude,
        });

        if (status === OfferStatus.ACCEPTED) {
          // 成功者占用名额：简历转已入职
          const targetResumeId = offer.resumeId
            ?? (await tx.resume.findFirst({ where: { candidateId: offer.candidateId, jobId: offer.jobId }, orderBy: { id: 'desc' } }))?.id;
          if (targetResumeId) {
            const before = await tx.resume.findUnique({ where: { id: targetResumeId } });
            await tx.resume.update({ where: { id: targetResumeId }, data: { status: ResumeStatus.HIRED } });
            await tx.auditLog.create({ data: {
              actorId: actorId ?? null,
              action: 'Resume_STATUS_CHANGE',
              entity: 'Resume',
              entityId: targetResumeId,
              beforeStatus: before?.status ?? null,
              afterStatus: ResumeStatus.HIRED,
              reason: '候选人接受 Offer，自动入职',
              candidateId: offer.candidateId,
            }});
          }

          // 岗位满员后自动关闭
          const hiredAfter = await tx.offer.count({ where: { jobId: offer.jobId, status: OfferStatus.ACCEPTED } });
          if (hiredAfter >= job.headcount && job.status === JobStatus.OPEN) {
            await tx.job.update({ where: { id: job.id }, data: { status: JobStatus.CLOSED } });
            await tx.auditLog.create({ data: {
              actorId: actorId ?? null,
              action: 'Job_STATUS_CHANGE',
              entity: 'Job',
              entityId: job.id,
              beforeStatus: job.status,
              afterStatus: JobStatus.CLOSED,
              reason: `已录用 ${hiredAfter}/${job.headcount}，名额招满自动关闭`,
              candidateId: null,
            }});
          }
        } else if (status === OfferStatus.SENT) {
          // 发送 Offer，简历推进到 Offer 阶段
          const targetResumeId = offer.resumeId
            ?? (await tx.resume.findFirst({ where: { candidateId: offer.candidateId, jobId: offer.jobId }, orderBy: { id: 'desc' } }))?.id;
          if (targetResumeId) {
            const before = await tx.resume.findUnique({ where: { id: targetResumeId } });
            if (before && before.status !== ResumeStatus.OFFERED && before.status !== ResumeStatus.HIRED) {
              await tx.resume.update({ where: { id: targetResumeId }, data: { status: ResumeStatus.OFFERED } });
              await tx.auditLog.create({ data: {
                actorId: actorId ?? null,
                action: 'Resume_STATUS_CHANGE',
                entity: 'Resume',
                entityId: targetResumeId,
                beforeStatus: before.status,
                afterStatus: ResumeStatus.OFFERED,
                reason: 'Offer 已发送，自动进入 Offer 阶段',
                candidateId: offer.candidateId,
              }});
            }
          }
        } else if (status === OfferStatus.REJECTED || status === OfferStatus.WITHDRAWN) {
          // 候选人拒绝或撤回：Offer 阶段的简历退回面试阶段，可重新发放
          const targetResumeId = offer.resumeId
            ?? (await tx.resume.findFirst({ where: { candidateId: offer.candidateId, jobId: offer.jobId }, orderBy: { id: 'desc' } }))?.id;
          if (targetResumeId) {
            const before = await tx.resume.findUnique({ where: { id: targetResumeId } });
            if (before && before.status === ResumeStatus.OFFERED) {
              await tx.resume.update({ where: { id: targetResumeId }, data: { status: ResumeStatus.INTERVIEWING } });
              await tx.auditLog.create({ data: {
                actorId: actorId ?? null,
                action: 'Resume_STATUS_CHANGE',
                entity: 'Resume',
                entityId: targetResumeId,
                beforeStatus: ResumeStatus.OFFERED,
                afterStatus: ResumeStatus.INTERVIEWING,
                reason: status === OfferStatus.REJECTED ? '候选人拒绝 Offer' : 'Offer 已撤回',
                candidateId: offer.candidateId,
              }});
            }
          }
        }

        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      return { ...updated, beforeStatus: offer.status, reason, candidateId: offer.candidateId };
    } catch (e) {
      // 竞争失败：原因落库到该 Offer，前端在岗位详情/候选人页展示失败原因
      if (status === OfferStatus.ACCEPTED && this.isHttpError(e)) {
        const failureReason = (e as Error).message;
        if (offer.status === OfferStatus.SENT) {
          await this.prisma.offer.update({ where: { id }, data: { failureReason } }).catch(() => undefined);
        }
      }
      throw e;
    }
  }

  private isHttpError(e: unknown): boolean {
    return typeof e === 'object' && e !== null && 'getStatus' in e && typeof (e as any).getStatus === 'function';
  }
}
