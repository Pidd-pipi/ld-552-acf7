import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { publicUserSelect } from '../../prisma/selects';
import { JobStatus, OfferStatus, ResumeStatus } from '../../constants/enums';

const flow: Record<OfferStatus, OfferStatus[]> = {
  DRAFT: [OfferStatus.APPROVED],
  APPROVED: [OfferStatus.SENT, OfferStatus.REJECTED],
  SENT: [OfferStatus.ACCEPTED, OfferStatus.REJECTED, OfferStatus.WITHDRAWN],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
};

/** 尚未结束的 Offer 状态：这些状态同一候选人+职位只允许一份 */
const ACTIVE_STATUSES: OfferStatus[] = [OfferStatus.DRAFT, OfferStatus.APPROVED, OfferStatus.SENT];

const offerDetailInclude = {
  candidate: true,
  job: true,
  resume: true,
  approver: { select: publicUserSelect },
} as const;

@Injectable()
export class OffersService {
  constructor(private prisma: PrismaService) {}

  async create(data: any) {
    const candidateId = Number(data.candidateId);

    // 必须存在该候选人投递、且处于面试阶段的简历；jobId 可由简历推导
    const resume = data.resumeId
      ? await this.prisma.resume.findFirst({ where: { id: Number(data.resumeId), candidateId } })
      : await this.prisma.resume.findFirst({ where: { candidateId, jobId: data.jobId ? Number(data.jobId) : undefined }, orderBy: { updatedAt: 'desc' } });
    if (!resume) throw new NotFoundException('未找到该候选人的投递简历');
    if (resume.status !== ResumeStatus.INTERVIEWING) {
      throw new BadRequestException(`简历当前为「${resume.status}」状态，仅面试中的候选人可以发放 Offer`);
    }

    const jobId = data.jobId != null ? Number(data.jobId) : resume.jobId;
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== JobStatus.OPEN) {
      throw new BadRequestException(`岗位当前为「${job.status}」状态，仅开放中的岗位可以创建 Offer`);
    }

    // 同一职位保留一份未结束的 Offer
    const activeOffer = await this.prisma.offer.findFirst({
      where: { candidateId, jobId, status: { in: ACTIVE_STATUSES } },
    });
    if (activeOffer) {
      throw new ConflictException('该候选人在此职位上已有一份未结束的 Offer，不能重复创建');
    }

    try {
      return await this.prisma.offer.create({
        data: {
          candidateId,
          jobId,
          resumeId: resume.id,
          salary: new Prisma.Decimal(String(data.salary)),
          startDate: new Date(data.startDate),
          status: OfferStatus.DRAFT,
          approverId: Number(data.approverId),
        },
        include: offerDetailInclude,
      });
    } catch (e) {
      // 并发下部分唯一索引兜底
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('该候选人在此职位上已有一份未结束的 Offer，不能重复创建');
      }
      throw e;
    }
  }

  async updateStatus(id: number, status: OfferStatus, reason?: string, actor?: { sub?: number }) {
    const offer = await this.prisma.offer.findUnique({ where: { id } });
    if (!offer) throw new NotFoundException('Offer not found');
    if (!flow[offer.status as OfferStatus].includes(status)) {
      throw new BadRequestException(`Invalid Offer status transition: ${offer.status} -> ${status}`);
    }

    if (status === OfferStatus.ACCEPTED) {
      return this.accept(offer, reason, actor);
    }

    const updated = await this.prisma.offer.update({
      where: { id },
      data: { status, failReason: null },
      include: offerDetailInclude,
    });
    return { ...updated, beforeStatus: offer.status, reason, candidateId: offer.candidateId };
  }

  /**
   * 接受录用：事务内锁定岗位行后核对剩余名额。
   * 两人争抢最后一个名额时，后到的事务在 FOR UPDATE 处等待，
   * 拿到锁后读到的 hiredCount 已包含前者占用，判定名额不足而失败。
   */
  private async accept(offer: { id: number; jobId: number; candidateId: number; status: string }, reason?: string, actor?: { sub?: number }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const job = await tx.$queryRaw<{ id: number; headcount: number; hired_count: number; status: string }[]>`
          SELECT id, headcount, "hiredCount" AS hired_count, status FROM "Job" WHERE id = ${offer.jobId} FOR UPDATE
        `.then((rows) => rows[0]);
        if (!job) throw new NotFoundException('Job not found');

        const remaining = job.headcount - job.hired_count;
        if (remaining <= 0) {
          throw new ConflictException(`该岗位剩余名额为 0（招聘 ${job.headcount} 人，已录用 ${job.hired_count} 人），无法接受录用`);
        }
        if (job.status === JobStatus.CLOSED || job.status === JobStatus.ARCHIVED) {
          throw new ConflictException('岗位已关闭/归档，无法接受 Offer');
        }

        await tx.job.update({ where: { id: offer.jobId }, data: { hiredCount: { increment: 1 } } });
        const updated = await tx.offer.update({
          where: { id: offer.id },
          data: { status: OfferStatus.ACCEPTED, failReason: null },
          include: offerDetailInclude,
        });

        // 简历转已入职
        const resume = offer.candidateId
          ? await tx.resume.findFirst({ where: { candidateId: offer.candidateId, jobId: offer.jobId } })
          : null;
        let beforeResumeStatus: string | undefined;
        if (resume && resume.status !== ResumeStatus.HIRED) {
          beforeResumeStatus = resume.status;
          await tx.resume.update({ where: { id: resume.id }, data: { status: ResumeStatus.HIRED } });
        }

        // 岗位满员后自动关闭（OPEN/PAUSED 均可流转到 CLOSED）
        const refreshed = await tx.job.findUnique({ where: { id: offer.jobId } });
        let jobAutoClosed = false;
        if (refreshed && refreshed.hiredCount >= refreshed.headcount && refreshed.status !== JobStatus.CLOSED && refreshed.status !== JobStatus.ARCHIVED) {
          await tx.job.update({ where: { id: offer.jobId }, data: { status: JobStatus.CLOSED } });
          jobAutoClosed = true;
        }

        // 级联状态变更同样写入审计（事务内，随业务结果一起提交）
        const now = new Date();
        if (resume && beforeResumeStatus) {
          await tx.auditLog.create({
            data: {
              actorId: actor?.sub ?? null,
              action: 'Resume_STATUS_CHANGE',
              entity: 'Resume',
              entityId: resume.id,
              beforeStatus: beforeResumeStatus,
              afterStatus: ResumeStatus.HIRED,
              reason: 'Offer 已接受，自动转已入职',
              candidateId: offer.candidateId,
              createdAt: now,
            },
          });
        }
        if (jobAutoClosed && refreshed) {
          await tx.auditLog.create({
            data: {
              actorId: actor?.sub ?? null,
              action: 'Job_STATUS_CHANGE',
              entity: 'Job',
              entityId: offer.jobId,
              beforeStatus: refreshed.status,
              afterStatus: JobStatus.CLOSED,
              reason: '岗位名额已录满，接受 Offer 时自动关闭',
              candidateId: offer.candidateId,
              createdAt: now,
            },
          });
        }

        return { ...updated, beforeStatus: offer.status, reason, candidateId: offer.candidateId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
    } catch (e) {
      if (e instanceof ConflictException) {
        // 事务已回滚；失败原因需要持久化，在事务外单独写入
        const failReason = e.message;
        await this.prisma.offer.update({ where: { id: offer.id }, data: { failReason } }).catch(() => undefined);
        await this.prisma.auditLog.create({
          data: {
            actorId: actor?.sub ?? null,
            action: 'OFFER_ACCEPT_FAILED',
            entity: 'Offer',
            entityId: offer.id,
            beforeStatus: offer.status,
            afterStatus: offer.status,
            reason: failReason,
            candidateId: offer.candidateId,
          },
        }).catch(() => undefined);
        throw new ConflictException(failReason);
      }
      throw e;
    }
  }
}
