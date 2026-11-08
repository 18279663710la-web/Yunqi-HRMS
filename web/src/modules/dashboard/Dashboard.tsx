import { useEffect, useState } from 'react';
import {
  App as AntApp,
  Avatar,
  Button,
  Card,
  Empty,
  List,
  Progress,
  Row,
  Col,
  Skeleton,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  AuditOutlined,
  SafetyOutlined,
  TagsOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';

import { fetchDashboard } from './api';
import { useWorkspaceActive } from '../../layout/WorkspaceContext';
import type { DashboardData } from '../../types';
import { accountStatusTag, initialOf } from '../../utils/helpers';

const { Text } = Typography;

export function DashboardPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const workspaceActive = useWorkspaceActive();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!workspaceActive) return;
    let mounted = true;
    setLoading(true);
    fetchDashboard()
      .then((result) => {
        if (mounted) setData(result);
      })
      .catch((err) => { if (mounted) message.error((err as Error).message); })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [message, workspaceActive]);

  const today = data?.today;
  const percent = today && today.total ? Math.round((today.checkedIn / today.total) * 100) : 0;

  const columns: ColumnsType<DashboardData['recentEmployees'][number]> = [
    {
      title: '员工',
      dataIndex: 'name',
      render: (_, row) => (
        <Space>
          <Avatar style={{ background: '#EAF0FF', color: '#3D6EF7' }}>{initialOf(row.name)}</Avatar>
          <div>
            <div style={{ fontWeight: 600 }}>{row.name}</div>
            <Text type="secondary" style={{ fontSize: 12 }}>{row.id}</Text>
          </div>
        </Space>
      ),
    },
    { title: '部门', dataIndex: 'deptName' },
    { title: '职务', dataIndex: 'position' },
    { title: '入职日期', dataIndex: 'joinDate' },
    {
      title: '账号',
      dataIndex: 'accountStatus',
      render: (status) => accountStatusTag(status),
    },
  ];

  return (
    <div className="page-stack">
      {loading && !data ? (
        <Card><Skeleton active /></Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} xl={6}>
              <Card className="stat-card" bordered={false}>
                <Statistic title="员工总数" value={data?.employeeCount || 0} prefix={<TeamOutlined style={{ color: '#3D6EF7' }} />} />
                <div className="stat-card-foot">组织内在职员工</div>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="stat-card" bordered={false}>
                <Statistic title="启用账号" value={data?.activeAccountCount || 0} prefix={<SafetyOutlined style={{ color: '#16B364' }} />} />
                <div className="stat-card-foot">可登录小程序 / 账号体系</div>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="stat-card" bordered={false}>
                <Statistic title="职务类型" value={data?.jobCategoryCounts.length || 0} prefix={<TagsOutlined style={{ color: '#7A5AF8' }} />} />
                <div className="stat-card-foot">
                  {(data?.jobCategoryCounts || []).map((item) => `${item.name} ${item.count}`).join(' · ') || '暂无职务'}
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="stat-card" bordered={false}>
                <Statistic title="待审批单据" value={data?.pendingApprovalCount || 0} prefix={<AuditOutlined style={{ color: '#F79009' }} />} />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={10}>
              <Card className="panel-card" title="今日考勤" bordered={false}>
                <div className="today-attendance">
                  <Progress
                    type="circle"
                    percent={percent}
                    size={132}
                    strokeColor={{ '0%': '#3D6EF7', '100%': '#7A5AF8' }}
                    format={() => (
                      <div>
                        <div className="progress-value">{today?.checkedIn || 0}</div>
                        <div className="progress-label">已打卡 / {today?.total || 0}</div>
                      </div>
                    )}
                  />
                  <div className="today-stats">
                    <div className="today-stat"><span className="dot dot-blue" />已打卡<strong>{today?.checkedIn || 0}</strong></div>
                    <div className="today-stat"><span className="dot dot-red" />未打卡<strong>{today?.notChecked || 0}</strong></div>
                    <div className="today-stat"><span className="dot dot-gray" />休息<strong>{today?.rest || 0}</strong></div>
                    <div className="today-stat"><span className="dot dot-purple" />请假<strong>{today?.onLeave || 0}</strong></div>
                  </div>
                </div>
              </Card>
            </Col>
            <Col xs={24} xl={14}>
              <Card className="panel-card" title="最近公告" bordered={false}>
                {data?.recentNotices.length ? (
                  <List
                    dataSource={data.recentNotices}
                    renderItem={(notice) => (
                      <List.Item>
                        <List.Item.Meta
                          avatar={
                            <Avatar size={32} shape="square" style={{ background: '#EAF0FF', color: '#3D6EF7', fontSize: 13 }}>
                              {notice.categoryName.slice(0, 1)}
                            </Avatar>
                          }
                          title={
                            <Space size={6}>
                              <span>{notice.title}</span>
                              {notice.isTop ? <Tag color="red" bordered={false}>置顶</Tag> : null}
                            </Space>
                          }
                          description={
                            <span>
                              {notice.categoryName} · {notice.publisher} · {notice.publishTime} · 已读 {notice.readCount}/{notice.totalCount}
                            </span>
                          }
                        />
                      </List.Item>
                    )}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告" />
                )}
              </Card>
            </Col>
          </Row>

          <Card
            className="panel-card"
            title="最近入职"
            bordered={false}
            extra={<Button type="link" onClick={() => navigate('/employees')}>查看全部</Button>}
          >
            <Table
              rowKey="id"
              size="small"
              columns={columns}
              dataSource={data?.recentEmployees || []}
              pagination={false}
              scroll={{ x: 720 }}
            />
          </Card>

          <div className="dashboard-footer">
            <Space size={8}>
              <span className="live-dot" />
              <span>管理后台与小程序共用 MySQL 数据库</span>
            </Space>
            <Text type="secondary">数据更新于刚刚</Text>
          </div>
        </>
      )}
    </div>
  );
}
