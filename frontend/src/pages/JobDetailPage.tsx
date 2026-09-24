import { CalendarOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { Card, Descriptions, List, Space, Tabs, Tag } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import CandidateCard from '../components/CandidateCard';
import PipelineKanban from '../components/PipelineKanban';
import { OfferStatus, statusText } from '../constants/enums';
import { api } from '../utils/api';

const offerColor: Record<string, string> = {
  DRAFT: 'default', APPROVED: 'blue', SENT: 'cyan', ACCEPTED: 'green', REJECTED: 'red', WITHDRAWN: 'orange',
};

export default function JobDetailPage(){
  const {id}=useParams();
  const [job,setJob]=useState<Job>();
  const [resumes,setResumes]=useState<Resume[]>([]);
  const [interviews,setInterviews]=useState<Interview[]>([]);
  const load=async()=>{
    const [j,r,i]=await Promise.all([api.get(`/jobs/${id}`),api.get(`/jobs/${id}/resumes`),api.get(`/jobs/${id}/interviews`)]);
    setJob(j.data); setResumes(r.data); setInterviews(i.data);
  };
  useEffect(()=>{load()},[id]);
  const headcount = job?.headcount ?? 0;
  const hiredCount = job?.hiredCount ?? 0;
  const remaining = headcount - hiredCount;
  const quotaFull = remaining <= 0;
  return <>
    <h1 className="page-title">{job?.title}</h1>
    <Card className="tf-card" style={{margin:'18px 0'}}
      extra={<Tag color="green">{job&&statusText[job.status]}</Tag>}
      title={<Space>
        <Tag color={quotaFull?'red':'blue'}>剩余名额 {remaining}</Tag>
        <Tag>招聘 {headcount} 人</Tag>
        <Tag color="green">已录用 {hiredCount} 人</Tag>
      </Space>}>
      {job?.department} · {job?.location} · {job?.salaryRange}
      <p>{job?.description}</p>
      <p className="subtle">{job?.requirements}</p>
    </Card>
    <Tabs items={[
      {key:'candidates',label:<><UnorderedListOutlined/>候选人列表</>,children:<div style={{display:'grid',gap:12}}>{resumes.map(r=>r.candidate&&<CandidateCard key={r.id} candidate={{...r.candidate,resumes:[r]}}/> )}</div>},
      {key:'kanban',label:'PipelineKanban 看板',children:<PipelineKanban resumes={resumes} onMove={async(rid,status)=>{await api.patch(`/resumes/${rid}/status`,{status,reason:'看板拖拽'});load();}}/>},
      {key:'offers',label:'Offer 与名额',children:<div style={{display:'grid',gap:12}}>
        <Descriptions size="small" bordered column={3} items={[
          {key:'headcount',label:'招聘名额',children:headcount},
          {key:'hired',label:'已录用',children:hiredCount},
          {key:'remaining',label:'剩余名额',children:<Tag color={quotaFull?'red':'green'}>{remaining}</Tag>},
        ]}/>
        <List dataSource={job?.offers||[]} locale={{emptyText:'暂无 Offer'}} renderItem={(o)=><List.Item>
          <List.Item.Meta
            title={<>{o.candidate?.name ?? `候选人 #${o.candidateId}`} · 薪资 {o.salary} · 入职 {new Date(o.startDate).toLocaleDateString()} <Tag color={offerColor[o.status]}>{statusText[o.status]}</Tag></>}
            description={o.failReason ? <Tag color="red">失败原因：{o.failReason}</Tag> : (o.status===OfferStatus.ACCEPTED ? '已占用名额' : '未占用名额')}
          />
        </List.Item>}/>
      </div>},
      {key:'calendar',label:<><CalendarOutlined/>面试日历</>,children:<div style={{display:'grid',gap:10}}>{interviews.map(i=><Card key={i.id} size="small">{i.resume?.candidate?.name} · 第 {i.round} 轮 · {new Date(i.scheduledAt).toLocaleString()} · {statusText[i.result]}</Card>)}</div>}
    ]} />
  </>;
}
