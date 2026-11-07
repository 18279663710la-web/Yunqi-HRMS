import { useEffect, useState } from 'react';
import { Alert, App, Button, Checkbox, DatePicker, Divider, Form, Input, List, Modal, Select, Space, Spin, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { pinyin } from 'pinyin-pro';
import { addOnboardingTask, confirmOnboarding, getOnboardingTasks, updateOnboardingTask, type OnboardingRecord, type OnboardingTask } from '../api';
import { fetchJobTitles, type JobTitle } from '../../organization/api';

interface Props { record: OnboardingRecord; onClose: () => void; onCompleted: () => Promise<void> }
interface EmployeeForm { name: string; employeeNo: string; phone: string; joinDate: Dayjs; jobCategory: string }

export function OnboardingProcess({ record, onClose, onCompleted }: Props) {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [required, setRequired] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [form] = Form.useForm<EmployeeForm>();
  const [jobTitles, setJobTitles] = useState<JobTitle[]>([]);
  const loadTasks = async () => {
    setLoading(true);
    try { setTasks(await getOnboardingTasks(record.id)); setLoadError(false); }
    catch (error) { setLoadError(true); message.error((error as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadTasks(); }, [record.id]);
  useEffect(() => { fetchJobTitles().then(setJobTitles).catch((error: Error) => message.error(error.message)); }, []);
  const addTask = async () => {
    if (!title.trim()) { message.warning('请输入任务名称'); return; }
    setSaving(true);
    try { await addOnboardingTask(record.id, title.trim(), required); setTitle(''); await loadTasks(); }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const toggleTask = async (task: OnboardingTask, completed: boolean) => {
    setSaving(true);
    try { await updateOnboardingTask(record.id, task.id, completed); await loadTasks(); }
    catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const submit = async (values: EmployeeForm) => {
    const namePinyin = pinyin(values.name, { toneType: 'none', type: 'array' }).join('').replace(/[^a-zA-Z]/g, '').toLowerCase();
    if (!namePinyin) { message.error('无法生成姓名拼音，请检查姓名'); return; }
    setSaving(true);
    try {
      await confirmOnboarding(record.id, { ...values, pinyin: namePinyin, joinDate: values.joinDate.format('YYYY-MM-DD') });
      message.success('已创建员工档案；小程序账号可单独开通');
      try { await onCompleted(); }
      catch { message.warning('建档已完成，但列表刷新失败，请刷新页面'); }
      onClose();
    } catch (error) { message.error((error as Error).message); }
    finally { setSaving(false); }
  };
  const requestedDate = record.fields['预计入职日期'];
  return <Modal title={`办理入职 · 申请 ${record.id}`} open onCancel={onClose} footer={null} width={720} destroyOnClose>
    <Typography.Paragraph type="secondary">{Object.entries(record.fields).map(([key, value]) => `${key}：${value}`).join('　·　')}</Typography.Paragraph>
    {record.employeeId && <Alert type="success" showIcon message={`已创建员工档案：${record.employeeId}`} />}
    <Divider orientation="left">入职任务</Divider>
    {loadError && <Alert type="error" message="任务加载失败，请重试" action={<Button onClick={() => void loadTasks()}>重试</Button>} />}
    <Spin spinning={loading}>
      <List locale={{ emptyText: '暂无任务，可按实际需要添加' }} dataSource={tasks} renderItem={(task) => <List.Item>
        <div><Checkbox checked={task.completed} disabled={saving} onChange={(event) => void toggleTask(task, event.target.checked)}>{task.title} {task.required ? '（建档前必需）' : '（可选）'}</Checkbox>
          {task.description && <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0 24px', whiteSpace: 'pre-wrap' }}>{task.description}</Typography.Paragraph>}
          {task.startDate && <Typography.Text type="secondary" style={{ marginLeft: 24 }}>计划：{task.startDate}{task.endDate ? ` 至 ${task.endDate}` : ' 起'}</Typography.Text>}
        </div>
      </List.Item>} />
    </Spin>
    <Space wrap style={{ marginTop: 12 }}>
      <Input aria-label="入职任务名称" value={title} maxLength={100} placeholder="任务名称" onChange={(event) => setTitle(event.target.value)} />
      <Checkbox checked={required} onChange={(event) => setRequired(event.target.checked)}>建档前必需完成</Checkbox>
      <Button onClick={() => void addTask()} disabled={loading || loadError} loading={saving}>添加任务</Button>
    </Space>
    {!record.employeeId && <>
      <Divider orientation="left">确认入职并创建员工档案</Divider>
      <Typography.Paragraph type="secondary">请核对员工信息；账号不会自动开通。没有任务时可直接建档。</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ name: record.fields['姓名'], phone: record.fields['联系电话'] || record.fields['电话'], joinDate: requestedDate && dayjs(requestedDate, 'YYYY-MM-DD', true).isValid() ? dayjs(requestedDate) : undefined }}>
        <Form.Item label="姓名" name="name" rules={[{ required: true, whitespace: true }]}><Input maxLength={50} /></Form.Item>
        <Form.Item label="工号" name="employeeNo" rules={[{ required: true, whitespace: true }]}><Input maxLength={30} /></Form.Item>
        <Form.Item label="联系电话" name="phone" rules={[{ required: true, min: 5, max: 20 }]}><Input maxLength={20} /></Form.Item>
        <Form.Item label="入职日期" name="joinDate" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="职务" name="jobCategory" rules={[{ required: true }]}><Select options={jobTitles.map(title => ({ value: title.name, label: title.name }))} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} disabled={loading || loadError || tasks.some((task) => task.required && !task.completed)}>确认建档</Button>
      </Form>
    </>}
  </Modal>;
}
