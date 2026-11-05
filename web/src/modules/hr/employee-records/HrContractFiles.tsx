import { useEffect, useRef, useState } from 'react';
import { App, Button, Card, Empty, Space, Spin, Typography } from 'antd';
import dayjs from 'dayjs';
import { downloadHrContractFile, getHrContractFiles, uploadHrContractFile, type HrContractFile } from '../api';

export function HrContractFiles({ employeeId }: { employeeId: string }) {
  const { message } = App.useApp();
  const inputRef = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [files, setFiles] = useState<HrContractFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState<number>();
  const [failed, setFailed] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const rows = await getHrContractFiles(employeeId); if (active.current) { setFiles(rows); setFailed(false); } }
    catch (error) { if (active.current) { setFailed(true); message.error((error as Error).message); } }
    finally { if (active.current) setLoading(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [employeeId]);
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || uploading) return;
    if (!/\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(file.name)) { message.warning('请选择 PDF、Word、JPG 或 PNG 文件'); return; }
    if (!file.size || file.size > 10 * 1024 * 1024) { message.warning('请选择不超过 10MB 的非空文件'); return; }
    setUploading(true);
    try { await uploadHrContractFile(employeeId, file); if (active.current) { message.success('合同文件已导入'); await load(); } }
    catch (error) { if (active.current) message.error((error as Error).message); }
    finally { if (active.current) setUploading(false); }
  };
  const download = async (file: HrContractFile) => {
    setDownloading(file.id);
    try { await downloadHrContractFile(employeeId, file); }
    catch (error) { if (active.current) message.error((error as Error).message); }
    finally { if (active.current) setDownloading(undefined); }
  };
  return <Card title="合同文件" variant="borderless" style={{ marginTop: 20 }} extra={<>
    <input ref={inputRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={event => void importFile(event)} style={{ display: 'none' }} />
    <Button onClick={() => inputRef.current?.click()} loading={uploading} disabled={uploading}>导入</Button>
  </>}>
    <Typography.Paragraph type="secondary">支持 PDF、Word、JPG、PNG，单个文件不超过 10MB。导入后立即保存，合同信息需另行保存。</Typography.Paragraph>
    <Spin spinning={loading}>
      {failed ? <Button onClick={() => void load()}>加载失败，点击重试</Button> : files.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无合同文件" /> :
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {files.map(file => <div key={file.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div><Typography.Text>{file.name}</Typography.Text><br /><Typography.Text type="secondary">{(file.size / 1024).toFixed(1)} KB · {dayjs(file.createdAt).format('YYYY-MM-DD HH:mm')}</Typography.Text></div>
            <Button type="link" onClick={() => void download(file)} loading={downloading === file.id} disabled={downloading !== undefined}>下载</Button>
          </div>)}
        </Space>}
    </Spin>
  </Card>;
}
