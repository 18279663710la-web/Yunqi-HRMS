import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, DatePicker, Form, Input, List, Modal, Popconfirm, Select, Space, Spin, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { addOffboardingTask, cancelDeparture, completeOffboarding, createOffboarding, finalizeOffboarding, getOffboarding, getOffboardingTasks, updateOffboardingTask, type HrEmployee, type OffboardingRecord, type OnboardingTask } from '../api';

export function HrOffboarding({ employees, onEmployeeChanged }: { employees: HrEmployee[]; onEmployeeChanged: () => Promise<void> }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<OffboardingRecord[]>([]);
  const [selected, setSelected] = useState<OffboardingRecord>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();
  const load = async () => { setLoading(true); try { setRows(await getOffboarding()); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const submit = async (values: { employeeId: string; lastDate: Dayjs; note?: string }) => {
    setLoading(true);
    try { await createOffboarding({ ...values, lastDate: values.lastDate.format('YYYY-MM-DD'), note: values.note || '' }); setOpen(false); form.resetFields(); await load(); message.success('离职清单已创建'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const finalize = async (record: OffboardingRecord) => {
    setLoading(true);
    try { await finalizeOffboarding(record.id); message.success('已确认离职并停用小程序账号'); await load(); try { await onEmployeeChanged(); } catch { message.warning('员工列表刷新失败，请刷新页面'); } }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const cancel = async (record: OffboardingRecord) => {
    setLoading(true);
    try { await cancelDeparture(record.id); message.success('已撤销离职；账号仍需管理员单独启用'); await load(); try { await onEmployeeChanged(); } catch { message.warning('员工列表刷新失败，请刷新页面'); } }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <Card title="离职清单" className="panel-card" bordered={false} extra={<Button type="primary" onClick={() => { form.resetFields(); setOpen(true); }}>新建清单</Button>}>
    <Alert showIcon type="info" message="先完成交接清单，再确认离职；确认后停用小程序账号，历史数据保留。" style={{ marginBottom: 16 }} />
    <Table rowKey="id" dataSource={rows} loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 600 }} columns={[
      { title: '员工', render: (_: unknown, row: OffboardingRecord) => `${row.name} · ${row.employeeNo}` },
      { title: '最后工作日', dataIndex: 'lastDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
      { title: '状态', render: (_: unknown, row: OffboardingRecord) => row.status === 'open' ? '办理中' : '已完成' },
      { title: '任务进度', render: (_: unknown, row: OffboardingRecord) => `${row.taskStatus === 'completed' ? '已完成' : row.taskStatus === 'in_progress' ? '进行中' : '待处理'}（${row.completedCount}/${row.taskCount}）` },
      { title: '离职确认', render: (_: unknown, row: OffboardingRecord) => row.departureStatus === 'departed' ? '已离职' : row.departureStatus === 'cancelled' ? '已撤销' : '未确认' },
      { title: '备注', dataIndex: 'note' }, { title: '操作', render: (_: unknown, row: OffboardingRecord) => <Space wrap><Button type="link" onClick={() => setSelected(row)}>查看任务</Button>
        {row.status === 'completed' && !row.departureStatus && <Popconfirm title="确认离职并停用小程序账号？" description="请先处理指定审批人及待处理单据。" onConfirm={() => void finalize(row)} okText="确认离职" cancelText="返回"><Button type="link" danger>确认离职</Button></Popconfirm>}
        {row.departureStatus === 'departed' && <Popconfirm title="撤销离职？" description="撤销后账号仍保持停用，可由管理员另行启用。" onConfirm={() => void cancel(row)} okText="撤销离职" cancelText="返回"><Button type="link">撤销离职</Button></Popconfirm>}
      </Space> },
    ]} />
    <Modal title="新建离职清单" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={loading} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
        <Form.Item label="员工" name="employeeId" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={employees.filter((employee) => employee.employmentStatus === 'active').map((employee) => ({ value: employee.id, label: `${employee.name} · ${employee.employeeNo}` }))} /></Form.Item>
        <Form.Item label="最后工作日" name="lastDate" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="备注" name="note"><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
    {selected && <OffboardingTasks record={selected} onClose={() => { setSelected(undefined); void load(); }} onCompleted={load} />}
  </Card>;
}

function OffboardingTasks({ record, onClose, onCompleted }: { record: OffboardingRecord; onClose: () => void; onCompleted: () => Promise<void> }) {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [title, setTitle] = useState('');
  const [required, setRequired] = useState(true);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = async () => { setLoading(true); try { setTasks(await getOffboardingTasks(record.id)); setFailed(false); } catch (error) { setFailed(true); message.error((error as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [record.id]);
  const add = async () => {
    if (!title.trim()) { message.warning('请输入任务名称'); return; } setLoading(true);
    try { await addOffboardingTask(record.id, title.trim(), required); setTitle(''); await load(); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const toggle = async (task: OnboardingTask, completed: boolean) => {
    setLoading(true); try { await updateOffboardingTask(record.id, task.id, completed); await load(); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  const complete = async () => {
    setLoading(true); try { await completeOffboarding(record.id); message.success('离职清单已完成'); await onCompleted(); onClose(); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <Modal title={`离职交接 · ${record.name}`} open onCancel={onClose} footer={null} destroyOnClose>
    {failed && <Alert type="error" message="任务加载失败" action={<Button onClick={() => void load()}>重试</Button>} />}
    <Spin spinning={loading}><List locale={{ emptyText: '暂无任务，可按需添加' }} dataSource={tasks} renderItem={(task) => <List.Item>
      <Checkbox checked={task.completed} disabled={loading || record.status !== 'open'} onChange={(event) => void toggle(task, event.target.checked)}>{task.title} {task.required ? '（必需）' : '（可选）'}</Checkbox>
    </List.Item>} /></Spin>
    {record.status === 'open' && <Space wrap style={{ marginTop: 16 }}>
      <Input aria-label="离职任务名称" placeholder="如：归还设备" maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} />
      <Checkbox checked={required} onChange={(event) => setRequired(event.target.checked)}>必需完成</Checkbox><Button onClick={() => void add()} disabled={loading || failed}>添加任务</Button>
      <Popconfirm title="确认完成离职清单？完成后不能修改。" onConfirm={() => void complete()} okText="确认" cancelText="取消"><Button type="primary" disabled={loading || failed || tasks.some((task) => task.required && !task.completed)}>完成清单</Button></Popconfirm>
    </Space>}
  </Modal>;
}
