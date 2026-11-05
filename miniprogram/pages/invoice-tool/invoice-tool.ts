/**
 * pages/invoice-tool — 发票工具台（TypeScript）
 *
 * 本地解析二维码，并通过服务端查询内部发票重复记录。
 */

import * as ocr from '../../services/invoices/ocr';
import * as verify from '../../services/invoices/verify';
import * as qrImage from '../../utils/qr-image';
import type { DuplicateResult, Invoice, ParsedInvoiceQR, VerifyResult } from '../../types/models';
import { toast } from '../../utils/util';

interface InfoRow {
  label: string;
  value: string;
}

interface DecodeInfo {
  ok: boolean;
  text?: string;
  message?: string;
  tried?: string[];
  region?: string;
  ms?: number;
  imageSize?: string;
}

interface InvoiceToolData {
  parsed: ParsedInvoiceQR | null;
  parseError: string;
  rows: InfoRow[];

  dupResult: DuplicateResult | null;
  checking: boolean;
  verifying: boolean;
  verifyResult: VerifyResult | null;
  imageVersion: number;

  /** 选图读码的调试信息 */
  decoding: boolean;
  decodeInfo: DecodeInfo | null;
  decodeRows: InfoRow[];
  previewPath: string;
}

interface InvoiceToolCustom {
  parse(text: string): boolean;
  buildRows(p: ParsedInvoiceQR): InfoRow[];
  toInvoice(): Invoice | null;
  onChooseImage(): void;
  onTakePhoto(): void;
  chooseImage(source: 'album' | 'camera'): void;
  onClearDecode(): void;
  onCheckDuplicate(): Promise<void>;
  onVerify(): Promise<void>;
}

Page<InvoiceToolData, InvoiceToolCustom>({
  data: {
    parsed: null,
    parseError: '',
    rows: [],

    dupResult: null,
    checking: false,
    verifying: false,
    verifyResult: null,
    imageVersion: 0,

    decoding: false,
    decodeInfo: null,
    decodeRows: [],
    previewPath: '',
  },

  /* ---------------- 录入 ---------------- */

  onChooseImage() {
    this.chooseImage('album');
  },

  onTakePhoto() {
    this.chooseImage('camera');
  },

  /**
   * 选一张发票照片，试着把图里的二维码读出来
   * 这是「上传发票自动读二维码」链路的单点调试入口。
   */
  chooseImage(source: 'album' | 'camera') {
    if (this.data.decoding) return;

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: [source],
      sizeType: ['original'], // 读码要原始分辨率
      camera: 'back',
      success: (res) => {
        const file = res && res.tempFiles && res.tempFiles[0];
        if (!file) return;

        this.setData({ decoding: true, previewPath: file.tempFilePath, parsed: null, rows: [], dupResult: null, verifyResult: null, parseError: '', decodeInfo: null, decodeRows: [], checking: false, verifying: false, imageVersion: this.data.imageVersion + 1 });

        void (async () => {
          let info: DecodeInfo;
          try {
            info = await qrImage.decodeFromImage(null, '#toolCanvas', file.tempFilePath);
          } catch (e) {
            info = {
              ok: false,
              message: (e as { message?: string }).message || '解码异常',
              tried: [],
            };
          }

          const rows: InfoRow[] = [
            { label: '耗时', value: info.ms != null ? `${info.ms} ms` : '—' },
          ];

          this.setData({ decoding: false, decodeInfo: info, decodeRows: rows });

          if (info.ok) {
            if (this.parse(info.text || '')) toast('已从图片中读出二维码');
          } else {
            toast(info.message || '图中未发现二维码');
          }
        })();
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        if (!msg.includes('cancel')) toast('选择图片失败');
      },
    });
  },

  /** 清掉读码调试信息 */
  onClearDecode() {
    this.setData({ decodeInfo: null, decodeRows: [], previewPath: '' });
  },

  /* ---------------- 解析 ---------------- */

  parse(text: string): boolean {
    const parsed = ocr.parseInvoiceQR(text);

    if (!parsed.ok) {
      this.setData({ parsed: null, parseError: parsed.message || '解析失败', rows: [], dupResult: null });
      toast(parsed.message || '解析失败');
      return false;
    }

    this.setData({
      parsed,
      parseError: '',
      rows: this.buildRows(parsed),
      dupResult: null,
    });
    return true;
  },

  buildRows(p: ParsedInvoiceQR): InfoRow[] {
    const money = (n: unknown) => `¥${(Number(n) || 0).toFixed(2)}`;
    return [
      { label: '类型代码', value: `${p.typeCode} · ${p.typeName}` },
      { label: '发票代码', value: p.invoiceCode || '—（数电票无此项）' },
      { label: '发票号码', value: p.invoiceNumber || '' },
      { label: '合计金额', value: money(p.totalAmount) },
      { label: '开票日期', value: p.invoiceDate || '—' },
      { label: 'CRC', value: ocr.formatInvoiceCrc(p) },
    ];
  },

  /** 解析结果转为内部查重所需的发票结构。 */
  toInvoice(): Invoice | null {
    const { parsed } = this.data;
    if (!parsed) return null;
    const amount = parsed.totalAmount || 0;

    return {
      ...ocr.emptyInvoice(),
      invoiceType: parsed.typeName || '',
      invoiceCode: parsed.invoiceCode || '',
      invoiceNumber: parsed.invoiceNumber || '',
      invoiceDate: parsed.invoiceDate || '',
      amount,
      taxAmount: 0,
      totalAmount: parsed.totalAmount || 0,
      checkCode: parsed.checkCode || '',
    };
  },

  /* ---------------- 查重 ---------------- */

  async onCheckDuplicate(): Promise<void> {
    const invoice = this.toInvoice();
    if (!invoice) {
      toast('请先解析发票二维码');
      return;
    }

    if (this.data.checking) return;
    const version = this.data.imageVersion;
    this.setData({ checking: true, verifyResult: null });
    try {
      const result = await verify.checkDuplicate(invoice);
      if (version !== this.data.imageVersion) return;
      this.setData({ checking: false, dupResult: result });

      if (!result.duplicated) toast('未发现重复报销');
      else if (result.blocking) toast('已在流转或已入账的单据中');
      else toast('命中已驳回单据，仅作提示');
    } catch {
      if (version === this.data.imageVersion) this.setData({ checking: false });
    }
  },

  /* ---------------- 查验 ---------------- */

  async onVerify(): Promise<void> {
    const invoice = this.toInvoice();
    if (!invoice) { toast('请先解析发票二维码'); return; }
    if (!this.data.dupResult) { toast('请先查重'); return; }
    if (this.data.dupResult.blocking) { toast('重复发票不能查验'); return; }
    if (this.data.verifying || this.data.checking) return;
    const version = this.data.imageVersion;
    this.setData({ verifying: true, verifyResult: null });
    try {
      const result = await verify.verifyInvoice(invoice);
      if (version !== this.data.imageVersion) return;
      this.setData({ verifying: false, verifyResult: result, dupResult: result.duplicate || this.data.dupResult });
    } catch {
      if (version === this.data.imageVersion) this.setData({ verifying: false });
    }
  },

});
