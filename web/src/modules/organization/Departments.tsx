import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  App as AntApp,
  Avatar,
  Card,
  Col,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ExperimentOutlined, ShopOutlined, UserOutlined } from '@ant-design/icons';

import { fetchJobCategories } from '../employees/api';
import { PageTitle } from '../../components/PageTitle';
import type { JobCategoryEmployee, JobCategoryGroup, JobCategoryName } from '../../types';
import { accountStatusTag, initialOf } from '../../utils/helpers';

const { Text } = Typography;

const CATEGORY_META: Record<
  JobCategoryName,
  { icon: ReactNode; color: string; desc: string }
> = {
  研发员: {
    icon: <ExperimentOutlined />,
    color: '#3D6EF7',
    desc: '技术研发与产品实现',
  },
  业务员: {
    icon: <ShopOutlined />,
    color: '#F79009',
    desc: '市场拓展与客户运营',
  },
  员工: {
    icon: <UserOutlined />,
    color: '#7A5AF8',
    desc: '综合职能与日常支持',
  },
};

type TableRow = JobCategoryEmployee & { jobCategory: JobCategoryName };

export function DepartmentsPage() {
  const { message } = AntApp.useApp();
  const [groups, setGroups] = useState<JobCategoryGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | JobCategoryName>('all');

  useEffect(() => {
    fetchJobCategories()
      .then(setGroups)
      .catch((err) => message.error((err as Error).message))
      .finally(() => setLoading(false));
  }, [message]);

  const rows = useMemo<TableRow[]>(() => {
    return groups.flatMap((group) =>
      group.employees.map((employee) => ({ ...employee, jobCategory: group.name }))
    );
  }, [groups]);

  const filteredRows = useMemo(
    () => (filter === 'all' ? rows : rows.filter((row) => row.jobCategory === filter)),
    [rows, filter]
  );

  const columns: ColumnsType<TableRow> = [
    {
      title: '员工',
      dataIndex: 'name',
      width: 240,
      render: (_, row) => (
        <Space>
          <Avatar style={{ background: '#EAF0FF', color: '#3D6EF7' }}>
            {initialOf(row.name)}
          </Avatar>
          <div>
            <div className="table-primary">
              {row.name}
              {row.isLeader ? <span className="leader-dot">负责人</span> : null}
            </div>
            <Text type="secondary" className="table-secondary">{row.employeeNo}</Text>
          </div>
        </Space>
      ),
    },
    {
      title: '职位',
      dataIndex: 'jobCategory',
      width: 140,
      render: (category: JobCategoryName) => {
        const color = category === '研发员' ? 'blue' : category === '业务员' ? 'orange' : 'purple';
        return <Tag color={color}>{category}</Tag>;
      },
    },
    { title: '手机号', dataIndex: 'phone', width: 160 },
    { title: '入职日期', dataIndex: 'joinDate', width: 130 },
    {
      title: '登录账号',
      dataIndex: 'loginName',
      width: 220,
      render: (_, row) => (
        <Space size={6}>
          {accountStatusTag(row.accountStatus)}
          {row.loginName ? <Text>{row.loginName}</Text> : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <PageTitle
        title="组织架构"
        extra={
          <Segmented
            value={filter}
            onChange={(value) => setFilter(value as 'all' | JobCategoryName)}
            options={[
              { label: '全部', value: 'all' },
              ...groups.map((group) => ({ label: group.name, value: group.name })),
            ]}
          />
        }
      />

      <Row gutter={[16, 16]}>
        {groups.map((group) => {
          const meta = CATEGORY_META[group.name];
          return (
            <Col xs={24} md={8} key={group.key}>
              <Card
                className="stat-card job-category-card"
                bordered={false}
                onClick={() => setFilter(group.name)}
                style={{ cursor: 'pointer' }}
              >
                <div className="job-category-head">
                  <div
                    className="job-category-icon"
                    style={{ background: `${meta.color}14`, color: meta.color }}
                  >
                    {meta.icon}
                  </div>
                  <div>
                    <div className="job-category-name">{group.name}</div>
                    <div className="job-category-desc">{meta.desc}</div>
                  </div>
                </div>
                <div className="job-category-count">
                  <strong>{group.count}</strong>
                  <span>人</span>
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      <Card className="panel-card" bordered={false}>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredRows}
          pagination={{
            pageSize: 15,
            showSizeChanger: true,
            showTotal: (value) => `共 ${value} 人`,
          }}
          scroll={{ x: 900 }}
        />
      </Card>
    </div>
  );
}
