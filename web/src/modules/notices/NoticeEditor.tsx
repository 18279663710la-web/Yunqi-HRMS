import { useState } from 'react';
import { App, Button, DatePicker, Form, Input, Modal, Progress, Select, Space, Switch, Table, Typography, Upload } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  CATEGORY_OPTIONS,
  createNotice,
  fetchAdminNotice,
  updateNotice,
  uploadNoticeFile,
  type NoticeAttachment,
  type NoticeBlock,
} from './api';

const BLOCK_TYPE_OPTIONS = [
  { value: 'p', label: '段落' },
  { value: 'h', label: '小标题' },
  { value: 'list', label: '列表' },
  { value: 'quote', label: '引用' },
];

interface NoticeEditorProps {
  notice?: import('./api').AdminNotice;
  onClose(): void;
  onSaved(): void;
}

interface EditorBlock extends NoticeBlock {
  key: number;
}

let blockKeySeq = 0;
function newKey(): number {
  blockKeySeq += 1;
  return blockKeySeq;
}

function toEditorBlocks(blocks: NoticeBlock[]): EditorBlock[] {
  return blocks.map((b) => ({ ...b, key: newKey() }));
}

export function NoticeEditor({ notice, onClose, onSaved }: NoticeEditorProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{
    title: string;
    category: string;
    isTop: boolean;
    publishTime: Dayjs;
    publisherDept: string;
    summary: string;
  }>();
  const [blocks, setBlocks] = useState<EditorBlock[]>(toEditorBlocks(notice?.blocks || [{ type: 'p', text: '' }]));
  const [attachments, setAttachments] = useState<NoticeAttachment[]>(notice?.attachments || []);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [readStats, setReadStats] = useState(notice?.readStats ?? { readCount: 0, totalCount: 0, readPercent: 0, readers: [] });

  const addBlock = () => setBlocks((prev) => [...prev, { type: 'p', text: '', key: newKey() }]);
  const removeBlock = (key: number) => setBlocks((prev) => (prev.length <= 1 ? prev : prev.filter((b) => b.key !== key)));
  const moveBlock = (key: number, delta: number) => setBlocks((prev) => {
    const idx = prev.findIndex((b) => b.key === key);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  });
  const patchBlock = (key: number, patch: Partial<EditorBlock>) =>
    setBlocks((prev) => prev.map((b) => (b.key === key ? { ...b, ...patch } : b)));

  const blockContent = (b: EditorBlock): string => (b.type === 'list' ? (b.items || []).join('\n') : b.text || '');

  const setBlockContent = (b: EditorBlock, value: string) => {
    if (b.type === 'list') patchBlock(b.key, { items: value.split(/\r?\n/).filter((line) => line.trim() !== '') });
    else patchBlock(b.key, { text: value });
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const att = await uploadNoticeFile(file);
      setAttachments((prev) => [...prev, att]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onRemoveAttachment = (target: NoticeAttachment) => setAttachments((prev) => prev.filter((a) => a.fileID !== target.fileID || a.name !== target.name));

  const onOk = async () => {
    const values = await form.validateFields();
    const cleanedBlocks = blocks
      .map((b) => ({ type: b.type, text: b.text?.trim(), items: (b.items || []).map((i) => i.trim()).filter(Boolean) }))
      .filter((b) => (b.type === 'list' ? (b.items?.length || 0) > 0 : !!b.text));
    if (!cleanedBlocks.length) {
      message.error('请至少填写一个正文块');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: values.title,
        category: values.category,
        isTop: !!values.isTop,
        publishTime: values.publishTime.format('YYYY-MM-DD HH:mm'),
        publisherDept: values.publisherDept || '-',
        summary: values.summary,
        blocks: cleanedBlocks,
        attachments,
      };
      if (notice) await updateNotice(notice.id, payload);
      else await createNotice(payload);
      message.success(notice ? '公告已更新' : '公告已发布');
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return <Modal
    open
    title={notice ? '编辑公告' : '新建公告'}
    width={760}
    onCancel={onClose}
    onOk={() => void onOk()}
    okText={notice ? '保存' : '发布'}
    confirmLoading={saving}
    destroyOnClose
  >
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        title: notice?.title,
        category: notice?.category || 'company',
        isTop: notice?.isTop || false,
        publishTime: notice?.publishTime ? dayjs(notice.publishTime, 'YYYY-MM-DD HH:mm') : dayjs(),
        publisherDept: notice?.publisherDept === '-' ? '' : notice?.publisherDept,
        summary: notice?.summary,
      }}
    >
      <Space style={{ display: 'flex', gap: 12 }} align="start">
        <Form.Item name="title" label="标题" style={{ flex: 1, minWidth: 320 }} rules={[{ required: true, message: '请输入标题' }]}>
          <Input maxLength={255} placeholder="公告标题" />
        </Form.Item>
        <Form.Item name="category" label="分类" style={{ width: 140 }} rules={[{ required: true }]}>
          <Select options={CATEGORY_OPTIONS} />
        </Form.Item>
        <Form.Item name="isTop" label="置顶" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Space>
      <Space style={{ display: 'flex', gap: 12 }} align="start">
        <Form.Item name="publishTime" label="发布时间" rules={[{ required: true, message: '请选择发布时间' }]}>
          <DatePicker showTime={{ format: 'HH:mm' }} format="YYYY-MM-DD HH:mm" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="publisherDept" label="发布部门">
          <Input maxLength={50} placeholder="如：人力资源部" style={{ width: 200 }} />
        </Form.Item>
      </Space>
      <Form.Item name="summary" label="摘要" rules={[{ required: true, message: '请输入摘要' }]}>
        <Input.TextArea rows={2} maxLength={500} showCount placeholder="列表与工作台展示用的公告摘要" />
      </Form.Item>

      <Typography.Paragraph style={{ marginBottom: 8, fontWeight: 600 }}>正文</Typography.Paragraph>
      {blocks.map((b, index) => (
        <Space key={b.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }} align="start">
          <Select
            value={b.type}
            options={BLOCK_TYPE_OPTIONS}
            style={{ width: 96 }}
            onChange={(type) => {
              const prevContent = blockContent(b);
              patchBlock(b.key, { type, text: type === 'list' ? undefined : prevContent, items: type === 'list' ? prevContent.split(/\r?\n/).filter(Boolean) : undefined });
            }}
          />
          <Input.TextArea
            rows={b.type === 'list' ? 3 : 2}
            value={blockContent(b)}
            placeholder={b.type === 'list' ? '每行一个条目' : '输入内容'}
            style={{ width: 480 }}
            onChange={(e) => setBlockContent(b, e.target.value)}
          />
          <Space size={0} direction="vertical">
            <Button size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => moveBlock(b.key, -1)} />
            <Button size="small" icon={<ArrowDownOutlined />} disabled={index === blocks.length - 1} onClick={() => moveBlock(b.key, 1)} />
          </Space>
          <Button size="small" icon={<DeleteOutlined />} disabled={blocks.length <= 1} onClick={() => removeBlock(b.key)} />
        </Space>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addBlock}>添加正文块</Button>

      <Typography.Paragraph style={{ margin: '20px 0 8px', fontWeight: 600 }}>附件（最多 10 个，单个 10MB）</Typography.Paragraph>
      <Upload
        multiple
        showUploadList={false}
        beforeUpload={(file) => { void onUpload(file); return false; }}
      >
        <Button icon={<UploadOutlined />} loading={uploading}>上传附件</Button>
      </Upload>
      {attachments.length ? (
        <div style={{ marginTop: 8 }}>
          {attachments.map((a) => (
            <Space key={`${a.fileID}-${a.name}`} style={{ display: 'flex', marginBottom: 4 }}>
              <Typography.Text>{a.name}</Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{a.size}</Typography.Text>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onRemoveAttachment(a)} />
            </Space>
          ))}
        </div>
      ) : null}

      {notice ? (
        <>
          <Typography.Paragraph style={{ margin: '20px 0 8px', fontWeight: 600 }}>已读回执</Typography.Paragraph>
          <Space style={{ display: 'flex', marginBottom: 8 }}>
            <Progress percent={readStats.readPercent} style={{ width: 220, margin: 0 }} />
            <Typography.Text type="secondary">{readStats.readCount}/{readStats.totalCount}（在职员工）</Typography.Text>
            <Button
              size="small"
              onClick={async () => {
                try {
                  const fresh = await fetchAdminNotice(notice.id);
                  setReadStats(fresh.readStats);
                } catch (e) {
                  message.error((e as Error).message);
                }
              }}
            >刷新回执</Button>
          </Space>
          <Table
            size="small"
            rowKey="employeeId"
            dataSource={readStats?.readers || []}
            columns={[
              { title: '员工', dataIndex: 'name', width: 100 },
              { title: '组织', dataIndex: 'department', ellipsis: true },
              { title: '阅读时间', dataIndex: 'readAt', width: 150 },
            ]}
            pagination={{ pageSize: 5, hideOnSinglePage: true }}
            locale={{ emptyText: '暂无已读回执' }}
          />
        </>
      ) : null}
    </Form>
  </Modal>;
}
