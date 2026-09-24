import { Alert, Button, Card, Descriptions, Form, Input, List, Modal, Popconfirm, Select, Space, Tabs, Tag, message } from 'antd';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import InterviewTimeline from '../components/InterviewTimeline';
import { OfferStatus, ResumeStatus, UserRole, statusText } from '../constants/enums';
import { useAuthStore } from '../stores/authStore';
import { api } from '../utils/api';

const offerColor: Record<string, string> = {
  DRAFT: 'default', APPROVED: 'blue', SENT: 'cyan', ACCEPTED: 'green', REJECTED: 'red', WITHDRAWN: 'orange',
};

export default function CandidateDetailPage(){
  const {id}=useParams();
  const [candidate,setCandidate]=useState<Candidate>();
  const [interviews,setInterviews]=useState<Interview[]>([]);
  const [audits,setAudits]=useState<AuditLog[]>([]);
  const [createOpen,setCreateOpen]=useState(false);
  const [form] = Form.useForm();
  const can = useAuthStore((s)=>s.can);
  const load=()=>Promise.all([api.get(`/candidates/${id}`),api.get(`/candidates/${id}/interviews`),api.get(`/audit-logs/candidate/${id}`).catch(()=>({data:[]}))]).then(([c,i,a])=>{setCandidate(c.data);setInterviews(i.data);setAudits(a.data)});
  useEffect(()=>{load()},[id]);

  const changeOfferStatus=async(offerId:number,status:OfferStatus,reason?:string)=>{
    try{
      await api.patch(`/offers/${offerId}/status`,{status,reason});
      message.success(`Offer 已更新为「${statusText[status]}」`);
      load();
    }catch(e:any){
      const msg = e?.response?.data?.message;
      message.error(Array.isArray(msg)?msg.join('；'):msg||'操作失败');
      load();
    }
  };

  // 仅面试阶段的投递可以发放 Offer
  const interviewingResumes = (candidate?.resumes||[]).filter((r)=>r.status===ResumeStatus.INTERVIEWING);

  const createOffer=async(v:any)=>{
    try{
      await api.post('/offers',{ ...v, candidateId: Number(id), resumeId: Number(v.resumeId), salary: Number(v.salary), approverId: Number(v.approverId) });
      message.success('Offer 草稿已创建');
      setCreateOpen(false); form.resetFields(); load();
    }catch(e:any){
      const msg = e?.response?.data?.message;
      message.error(Array.isArray(msg)?msg.join('；'):msg||'创建失败');
    }
  };

  return <>
    <h1 className="page-title">{candidate?.name}</h1>
    <div style={{display:'grid',gridTemplateColumns:'320px 1fr',gap:18,marginTop:18}}>
      <Card className="tf-card"><Descriptions column={1} size="small" items={[{key:'email',label:'邮箱',children:candidate?.email},{key:'phone',label:'手机',children:candidate?.phone},{key:'source',label:'来源',children:candidate?.source}]}/></Card>
      <Tabs items={[
        {key:'resumes',label:'投递记录',children:<List dataSource={candidate?.resumes||[]} renderItem={(r)=><List.Item><List.Item.Meta title={<Space>{r.job?.title}{r.job && <Tag color={(r.job.headcount-(r.job.hiredCount??0))<=0?'red':'green'}>岗位剩余 {r.job.headcount-(r.job.hiredCount??0)}</Tag>}</Space>} description={<><Tag>{statusText[r.status]}</Tag>{r.resumeUrl}</>}/></List.Item>}/>},
        {key:'timeline',label:'InterviewTimeline 面试时间线',children:<InterviewTimeline interviews={interviews}/>},
        {key:'offers',label:`Offer 状态 (${candidate?.offers?.length||0})`,children:<>
          {can([UserRole.HR,UserRole.ADMIN]) && <div style={{marginBottom:12}}><Button type="primary" disabled={!interviewingResumes.length} onClick={()=>setCreateOpen(true)}>发放 Offer（仅面试中）</Button>{!interviewingResumes.length && <span className="subtle" style={{marginLeft:8}}>该候选人没有处于面试阶段的投递</span>}</div>}
          <List dataSource={candidate?.offers||[]} locale={{emptyText:'暂无 Offer'}} renderItem={(o)=>{
          const remaining = (o.job?.headcount ?? 0) - (o.job?.hiredCount ?? 0);
          return <List.Item>
            <List.Item.Meta
              title={<Space wrap>{o.job?.title} · {o.salary} · <Tag color={offerColor[o.status]}>{statusText[o.status]}</Tag>
                {o.job && <Tag color={remaining<=0?'red':'green'}>岗位剩余名额 {remaining}（招 {o.job.headcount} / 已录 {o.job.hiredCount ?? 0}）</Tag>}
              </Space>}
              description={<Space direction="vertical" style={{width:'100%'}}>
                {o.failReason && <Alert type="error" showIcon message="失败原因" description={o.failReason}/>}
                <Space wrap>
                  {o.status===OfferStatus.DRAFT && can([UserRole.HIRING_MANAGER,UserRole.ADMIN]) && <Button size="small" type="primary" onClick={()=>changeOfferStatus(o.id,OfferStatus.APPROVED,'经理审批通过')}>审批通过</Button>}
                  {o.status===OfferStatus.APPROVED && can([UserRole.HR,UserRole.ADMIN]) && <Button size="small" type="primary" onClick={()=>changeOfferStatus(o.id,OfferStatus.SENT,'发送给候选人')}>发送 Offer</Button>}
                  {o.status===OfferStatus.SENT && <Popconfirm title="确认接受该录用？将占用岗位名额" onConfirm={()=>changeOfferStatus(o.id,OfferStatus.ACCEPTED,'候选人接受录用')}><Button size="small" type="primary">接受录用</Button></Popconfirm>}
                  {o.status===OfferStatus.SENT && <Button size="small" danger onClick={()=>changeOfferStatus(o.id,OfferStatus.REJECTED,'候选人拒绝')}>拒绝</Button>}
                  {o.status===OfferStatus.SENT && can([UserRole.HR,UserRole.ADMIN]) && <Button size="small" onClick={()=>changeOfferStatus(o.id,OfferStatus.WITHDRAWN,'HR 撤回')}>撤回</Button>}
                </Space>
              </Space>}
            />
          </List.Item>;
        }}/></>},
        {key:'audit',label:'状态流转审计',children:<List dataSource={audits} renderItem={(a)=><List.Item>{a.entity} #{a.entityId}: {a.beforeStatus} → {a.afterStatus} · {a.actor?.name || '系统'} · {a.reason}</List.Item>}/>}
      ]} />
    </div>

    <Modal title="发放 Offer（创建草稿）" open={createOpen} onCancel={()=>setCreateOpen(false)} onOk={()=>form.submit()} okText="创建草稿">
      <Form form={form} layout="vertical" onFinish={createOffer} initialValues={{ approverId: 3, startDate: new Date(Date.now()+86400000*30).toISOString().slice(0,10) }}>
        <Form.Item label="投递岗位（须为面试中）" name="resumeId" rules={[{required:true}]}>
          <Select options={interviewingResumes.map((r)=>({value:r.id,label:`${r.job?.title}（剩余名额 ${(r.job?.headcount??0)-(r.job?.hiredCount??0)}）`}))}/>
        </Form.Item>
        <Form.Item label="薪资" name="salary" rules={[{required:true}]}><Input type="number" addonAfter="元/月"/></Form.Item>
        <Form.Item label="入职日期" name="startDate" rules={[{required:true}]}><Input type="date"/></Form.Item>
        <Form.Item label="审批人 ID（招聘经理）" name="approverId" rules={[{required:true}]}><Input type="number"/></Form.Item>
      </Form>
    </Modal>
  </>;
}
