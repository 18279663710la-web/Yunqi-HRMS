import { useEffect, useState } from 'react';
import { App, Button, Card, DatePicker, Form, Input, Modal, Select, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { addHrEvent, getHrEvents, getHrHistory, type HrEvent, type HrHistory } from '../api';
import { formatHrHistory } from './salaryHistory';

export function HrEvents({ employeeId }: { employeeId: string }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<HrEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const load = async () => { setLoading(true); try { setRows(await getHrEvents(employeeId)); } catch (error) { message.error((error as Error).message); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [employeeId]);
  const submit = async (values: { type: string; effectiveDate: Dayjs; note?: string }) => {
    setLoading(true);
    try { await addHrEvent({ employeeId, type: values.type, effectiveDate: values.effectiveDate.format('YYYY-MM-DD'), note: values.note || '' }); setOpen(false); form.resetFields(); await load(); message.success('人事事件已登记'); }
    catch (error) { message.error((error as Error).message); } finally { setLoading(false); }
  };
  return <Card title="人事事件" extra={<Button type="primary" onClick={() => setOpen(true)}>登记事件</Button>} bordered={false}>
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 5 }} columns={[
      { title: '类型', dataIndex: 'type' }, { title: '生效日期', dataIndex: 'effectiveDate', render: (value: string) => dayjs(value).format('YYYY-MM-DD') }, { title: '说明', dataIndex: 'note' },
    ]} />
    <Modal title="登记人事事件" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} confirmLoading={loading} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={submit} preserve={false}>
        <Form.Item label="事件类型" name="type" rules={[{ required: true }]}><Select options={['转正', '调岗', '调薪', '其他'].map((value) => ({ value, label: value }))} /></Form.Item>
        <Form.Item label="生效日期" name="effectiveDate" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="说明" name="note"><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>
  </Card>;
}

export function HrRecordHistory({ employeeId, section, revision }: { employeeId: string; section: 'contract' | 'salary'; revision: number }) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<HrHistory[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true);
    getHrHistory(employeeId, section).then((items) => { if (active) setRows(items); }).catch((error: Error) => { if (active) message.error(error.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employeeId, section, revision]);
  return <Card title="历史记录" bordered={false} style={{ marginTop: 20 }}>
    <Table rowKey="id" loading={loading} dataSource={rows} pagination={{ pageSize: 5 }} locale={{ emptyText: '暂无历史记录，保存后开始记录' }} columns={[
      { title: '保存时间', dataIndex: 'createdAt', render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm') },
      { title: '内容', render: (_: unknown, row: HrHistory) => formatHrHistory(row.data, section) },
    ]} />
  </Card>;
}
