import { message } from 'antd';
import { create } from 'zustand';
import { JobStatus } from '../constants/enums';
import { api } from '../utils/api';
type JobState = { jobs: Job[]; loadJobs: (filters?: { status?: JobStatus; department?: string }) => Promise<void>; changeStatus: (id: number, status: JobStatus) => Promise<void> };
export const useJobStore = create<JobState>((set, get) => ({ jobs: [], async loadJobs(filters) { const { data } = await api.get('/jobs', { params: filters }); set({ jobs: data }); }, async changeStatus(id, status) { try { await api.patch(`/jobs/${id}/status`, { status, reason: '前端操作' }); await get().loadJobs(); } catch (e: any) { const m = e?.response?.data?.message; message.error(Array.isArray(m) ? m.join('；') : m || '状态变更失败'); await get().loadJobs(); } } }));
