import { downloadBusinessPdf, get, getCachedUser } from '../../../../utils/request';
import { getCurrentUser } from '../../../../services/auth/api';

interface ReceivableLine {
  lineNum: number; srcShipNo: string; srcLineNum: number;
  itemName: string; itemCode: string; uom: string; qty: string;
  nonTaxPrice: string; taxPrice: string; nonTaxAmount: string; taxAmount: string;
  taxIncludedTotal: string; totalAmount: string; totalBalance: string;
  bizOrg: string; maturity: string | null; lineStatus: string;
}
interface ReceivableDocument {
  id: string; docNo: string; customer: string; businessDate: string; postPeriod: string;
  srcOrg: string; invoiceDate: string | null; invoiceNum: string; lines: ReceivableLine[];
}
interface Data { id: string; document: ReceivableDocument | null; loading: boolean; error: string; opening: boolean }
interface Methods { load(): Promise<void>; retry(): void; download(): void }

Page<Data, Methods>({
  data: { id: '', document: null, loading: true, error: '', opening: false },

  onLoad(options: Record<string, string | undefined>) {
    const id = String(options.id || '');
    this.setData({ id });
    if (!/^\d+$/.test(id)) {
      this.setData({ loading: false, error: '单据参数无效' });
      return;
    }
    void getCurrentUser().then(user => {
      if (user.isChairperson || user.position !== '业务员') {
        wx.switchTab({ url: '/pages/index/index' });
        return;
      }
      void this.load();
    }).catch(() => this.setData({ loading: false, error: '无法确认账号权限，请重试' }));
  },

  async load() {
    if (!this.data.id) return;
    this.setData({ loading: true, error: '' });
    try {
      const document = await get<ReceivableDocument>(`/business/receivables/${this.data.id}`);
      this.setData({ document });
    } catch (error) {
      this.setData({ error: (error as { message?: string }).message || '加载失败，请重试' });
    } finally {
      this.setData({ loading: false });
    }
  },

  retry() {
    void this.load();
  },

  download() {
    const document = this.data.document;
    if (!document || this.data.opening) return;
    const employeeId = getCachedUser()?.id;
    if (!employeeId) { wx.showToast({ title: '请重新登录', icon: 'none' }); return; }
    this.setData({ opening: true });
    void downloadBusinessPdf(`/business/receivables/${document.id}/pdf`).then(filePath => {
      if (getCachedUser()?.id !== employeeId) throw { message: '登录账号已变更，请重试' };
      return new Promise<void>((resolve, reject) => wx.openDocument({ filePath, fileType: 'pdf', showMenu: true, success: () => resolve(), fail: reject }));
    })
      .catch((error: { message?: string }) => wx.showToast({ title: error.message || '打开失败，请重试', icon: 'none' }))
      .finally(() => this.setData({ opening: false }));
  },
});
