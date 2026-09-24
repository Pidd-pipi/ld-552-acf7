import { OfferStatus } from '../constants/enums';
declare global { interface Offer { id: number; candidateId: number; jobId: number; resumeId?: number; salary: string; startDate: string; status: OfferStatus; approverId: number; failReason?: string | null; candidate?: Candidate; job?: Job; resume?: Resume; approver?: User; } }
export {};
