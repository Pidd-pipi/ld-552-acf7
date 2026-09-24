import { Alert, Card, Descriptions, Empty, List, Space, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InterviewTimeline from '../components/InterviewTimeline';
import { statusText } from '../constants/enums';
import { api } from '../utils/api';

const offerTagColor: Record<string, string> = {
  DRAFT: 'default', APPROVED: 'blue', SENT: 'gold', ACCEPTED: 'green', REJECTED: 'red', WITHDRAWN: 'red',
};

export default function CandidateDetailPage() {
  const { id } = useParams();
  const [candidate, setCandidate] = useState<Candidate>();
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [audits, setAudits] = useState<AuditLog[]>([]);
  useEffect(() => {
    Promise.all([
      api.get(`/candidates/${id}`),
      api.get(`/candidates/${id}/interviews`),
      api.get(`/audit-logs/candidate/${id}`).catch(() => ({ data: [] })),
    ]).then(([c, i, a]) => { setCandidate(c.data); setInterviews(i.data); setAudits(a.data); });
  }, [id]);

  return <>
    <h1 className="page-title">{candidate?.name}</h1>
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, marginTop: 18 }}>
      <Card className="tf-card">
        <Descriptions column={1} size="small" items={[
          { key: 'email', label: '邮箱', children: candidate?.email },
          { key: 'phone', label: '手机', children: candidate?.phone },
          { key: 'source', label: '来源', children: candidate?.source },
        ]} />
      </Card>
      <Tabs items={[
        {
          key: 'resumes', label: '投递记录',
          children: <List dataSource={candidate?.resumes || []} renderItem={(r) => <List.Item><List.Item.Meta title={r.job?.title} description={<><Tag>{statusText[r.status]}</Tag>{r.resumeUrl}</>} /></List.Item>} />,
        },
        { key: 'timeline', label: 'InterviewTimeline 面试时间线', children: <InterviewTimeline interviews={interviews} /> },
        {
          key: 'offers', label: 'Offer 状态',
          children: (candidate?.offers || []).length === 0 ? <Empty description="暂无 Offer" /> : <Space direction="vertical" style={{ width: '100%' }}>
            {(candidate?.offers || []).map((o) => <Card key={o.id} size="small" data-testid="candidate-offer">
              <Space wrap>
                {o.job?.title}
                <Tag color={offerTagColor[o.status]}>{statusText[o.status]}</Tag>
                <Tag>{String(o.salary)}</Tag>
                {o.jobRemainingSlots !== undefined && (
                  <Tag color={o.jobRemainingSlots <= 0 ? 'red' : 'blue'}>
                    {o.job?.title} 剩余名额 {o.jobRemainingSlots}（已录用 {o.jobHiredCount}/{o.job?.headcount}）
                  </Tag>
                )}
              </Space>
              {o.failureReason && <Alert style={{ marginTop: 8 }} type="error" showIcon data-testid="offer-failure" message="接受录用失败原因" description={o.failureReason} />}
            </Card>)}
          </Space>,
        },
        {
          key: 'audit', label: '状态流转审计',
          children: <List dataSource={audits} renderItem={(a) => <List.Item>{a.entity} #{a.entityId}: {a.beforeStatus} → {a.afterStatus} · {a.actor?.name || '系统'} · {a.reason}</List.Item>} />,
        },
      ]} />
    </div>
  </>;
}
