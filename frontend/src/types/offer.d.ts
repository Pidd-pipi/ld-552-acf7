import { OfferStatus } from '../constants/enums';
declare global { interface Offer { id: number; candidateId: number; jobId: number; resumeId?: number; salary: string; startDate: string; status: OfferStatus; failureReason?: string | null; approverId: number; candidate?: Candidate; job?: Job; resume?: Resume; approver?: User; jobHiredCount?: number; jobRemainingSlots?: number; } }
export {};
