import { useCallback, useEffect, useState } from 'react';
import { App, Button, Input, Popconfirm, Progress, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import { SubModuleHeader } from '../../components/SubModuleHeader';
import { CATEGORY_OPTIONS, deleteNotice, fetchAdminNotices, type AdminNotice } from './api';
import { NoticeEditor } from './NoticeEditor';

interface TableNotice extends AdminNotice {
  key: string;
}

export function NoticesPage() {
  const { message } = App.useApp();
  const active = useWorkspaceActive();
  const [list, setList] = useState<TableNotice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [keyword, setKeyword] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminNotice>();
  const [deletingId, setDeletingId] = useState<string>();

  const load = useCallback(async (targetPage = page) => {
    setLoading(true);
    try {
      const data = await fetchAdminNotices({ keyword, category, page: targetPage, pageSize });
      setList(data.list.map((n) => ({ ...n, key: n.id })));
      setTotal(data.total);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [keyword, category, page, message]);

  useEffect(() => {
    if (active) void load(page);
  }, [active, page, keyword, category, load]);

  const reloadFirstPage = () => {
    setPage(1);
    void load(1);
  };

  const onDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteNotice(id);
      message.success('公告已删除');
      await load(page);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setDeletingId(undefined);
    }
  };

  const onEditorSaved = () => {
    setEditorOpen(false);
    setEditing(undefined);
    reloadFirstPage();
  };

  const columns: ColumnsType<TableNotice> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (_, record) => (
        <Space size={6}>
          <span>{record.title}</span>
          {record.isTop ? <Tag color="red" bordered={false}>置顶</Tag> : null}
        </Space>
      ),
    },
    { title: '分类', dataIndex: 'categoryName', width: 96 },
    { title: '发布人', dataIndex: 'publisher', width: 100 },
    { title: '发布时间', dataIndex: 'publishTime', width: 150 },
    {
      title: '已读进度',
      dataIndex: 'readStats',
      width: 170,
      render: (_, record) => (
        <Space size={8}>
          <Progress
            percent={record.readStats.readPercent}
            size="small"
            style={{ width: 90, margin: 0 }}
            showInfo={false}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {record.readStats.readCount}/{record.readStats.totalCount}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 130,
      render: (_, record) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => { setEditing(record); setEditorOpen(true); }}>编辑</Button>
          <Popconfirm
            title="删除公告"
            description="删除后员工端立即不可见，阅读回执一并清除。确定删除吗？"
            okText="删除"
            okButtonProps={{ danger: true }}
            onConfirm={() => void onDelete(record.id)}
          >
            <Button type="link" size="small" danger loading={deletingId === record.id}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return <div>
    <SubModuleHeader
      title="公告管理"
      extra={
        <Space>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => { setEditing(undefined); setEditorOpen(true); }}>新建公告</Button>
        </Space>
      }
    />
    <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <Input.Search
        allowClear
        placeholder="搜索公告标题或内容"
        style={{ width: 260 }}
        onSearch={(value) => { setKeyword(value); setPage(1); }}
      />
      <Select
        style={{ width: 140 }}
        value={category}
        options={[{ value: 'all', label: '全部分类' }, ...CATEGORY_OPTIONS]}
        onChange={(value) => { setCategory(value); setPage(1); }}
      />
      <Button icon={<ReloadOutlined />} onClick={reloadFirstPage}>刷新</Button>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>共 {total} 条公告</Typography.Text>
    </div>
    <Table
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={list}
      pagination={{ current: page, pageSize, total, showSizeChanger: false, onChange: (p) => setPage(p) }}
    />
    {editorOpen ? (
      <NoticeEditor
        notice={editing}
        onClose={() => { setEditorOpen(false); setEditing(undefined); }}
        onSaved={onEditorSaved}
      />
    ) : null}
  </div>;
}
