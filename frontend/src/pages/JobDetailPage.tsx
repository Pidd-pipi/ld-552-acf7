import { CalendarOutlined, UnorderedListOutlined, SolutionOutlined } from '@ant-design/icons';
import { Alert, Card, Descriptions, Empty, Space, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CandidateCard from '../components/CandidateCard';
import PipelineKanban from '../components/PipelineKanban';
import { statusText } from '../constants/enums';
import { api } from '../utils/api';

const offerTagColor: Record<string, string> = {
  DRAFT: 'default', APPROVED: 'blue', SENT: 'gold', ACCEPTED: 'green', REJECTED: 'red', WITHDRAWN: 'red',
};

export default function JobDetailPage() {
  const { id } = useParams();
  const [job, setJob] = useState<Job>();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const load = async () => {
    const [j, r, i] = await Promise.all([
      api.get(`/jobs/${id}`),
      api.get(`/jobs/${id}/resumes`),
      api.get(`/jobs/${id}/interviews`),
    ]);
    setJob(j.data); setResumes(r.data); setInterviews(i.data);
  };
  useEffect(() => { load(); }, [id]);

  const remaining = job?.remainingSlots;
  const full = remaining !== undefined && remaining <= 0;

  return <>
    <h1 className="page-title">{job?.title}</h1>
    <Card className="tf-card" style={{ margin: '18px 0' }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag color="green">{job && statusText[job.status]}</Tag>
        {remaining !== undefined && (
          <Tag color={full ? 'red' : 'blue'} data-testid="quota-tag">
            剩余名额 {remaining} / {job?.headcount}（已录用 {job?.hiredCount} 人）
          </Tag>
        )}
        {full && <Tag color="red">岗位已招满关闭</Tag>}
      </Space>
      <Descriptions size="small" column={3} items={[
        { key: 'dept', label: '部门', children: job?.department },
        { key: 'loc', label: '地点', children: job?.location },
        { key: 'salary', label: '薪资', children: job?.salaryRange },
      ]} />
      <p>{job?.description}</p>
      <p className="subtle">{job?.requirements}</p>
    </Card>
    <Tabs items={[
      {
        key: 'candidates', label: <><UnorderedListOutlined />候选人列表</>,
        children: <div style={{ display: 'grid', gap: 12 }}>{resumes.map(r => r.candidate && <CandidateCard key={r.id} candidate={{ ...r.candidate, resumes: [r] }} />)}</div>,
      },
      {
        key: 'kanban', label: 'PipelineKanban 看板',
        children: <PipelineKanban resumes={resumes} onMove={async (rid, status) => { await api.patch(`/resumes/${rid}/status`, { status, reason: '看板拖拽' }); load(); }} />,
      },
      {
        key: 'offers', label: <><SolutionOutlined />Offer 与名额</>,
        children: <Space direction="vertical" style={{ width: '100%' }}>
          <Alert
            type={full ? 'error' : 'success'}
            showIcon
            data-testid="quota-alert"
            message={full ? '该岗位名额已招满，岗位已自动关闭，不能重新开放' : `剩余录用名额 ${remaining} 个`}
            description={`招聘 ${job?.headcount ?? '-'} 人，已录用（接受 Offer）${job?.hiredCount ?? '-'} 人。多名候选人争抢最后名额时，仅先完成接受者占用名额，其余接受会失败并记录原因。`}
          />
          {(job?.offers ?? []).length === 0 ? <Empty description="暂无 Offer 记录" /> : (job!.offers!).map(o => <Card key={o.id} size="small">
            <Space wrap>
              <Typography.Text strong>#{o.id} {o.candidate?.name}</Typography.Text>
              <Tag color={offerTagColor[o.status]}>{statusText[o.status]}</Tag>
              <Tag>薪资 {String(o.salary)}</Tag>
              <Typography.Text type="secondary">入职日 {new Date(o.startDate).toLocaleDateString()}</Typography.Text>
            </Space>
            {o.failureReason && <Alert style={{ marginTop: 8 }} type="error" showIcon data-testid="offer-failure" message="接受录用失败" description={o.failureReason} />}
          </Card>)}
        </Space>,
      },
      {
        key: 'calendar', label: <><CalendarOutlined />面试日历</>,
        children: <div style={{ display: 'grid', gap: 10 }}>{interviews.map(i => <Card key={i.id} size="small">{i.resume?.candidate?.name} · 第 {i.round} 轮 · {new Date(i.scheduledAt).toLocaleString()} · {statusText[i.result]}</Card>)}</div>,
      },
    ]} />
  </>;
}
