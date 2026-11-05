/**
 * invoiceSamples.ts — 发票识别 / 查验样本数据（服务端）
 *
 * 仅用于 OCR_DRIVER=mock / VERIFY_DRIVER=mock 的演示模式：
 * 上传任意图片时，服务端从这些样本中返回结构化结果。
 * 数据取自真实票面结构，金额与税额按对应税率勾稽：
 *   13% 货物 / 9% 运输 / 6% 服务 / 6% 住宿餐饮
 * 接入真实 OCR / 税局核验通道后，可在对应 service 中替换实现。
 */

const BUYER = {
  name: '云启科技有限公司',
  taxNo: '91440300MA5EXK7T9P',
  address: '深圳市南山区科技园科苑路 15 号云启大厦 12 层',
};

const invoices = [
  {
    kind: 'vat_normal',
    invoiceType: '增值税电子普通发票',
    invoiceCode: '044031900111',
    invoiceNumber: '08812453',
    invoiceDate: '2026-10-08',
    sellerName: '深圳市云海餐饮管理有限公司',
    sellerTaxNo: '91440300MA5F8Q2X7L',
    category: '餐饮',
    itemName: '餐饮服务*餐费',
    amount: 386.0,
    taxRate: '6%',
    taxAmount: 23.16,
    totalAmount: 409.16,
    checkCode: '0718 2231 0045 8812',
    remark: '业务招待用餐',
  },
  {
    kind: 'vat_normal',
    invoiceType: '增值税电子普通发票',
    invoiceCode: '044031900111',
    invoiceNumber: '08812771',
    invoiceDate: '2026-10-09',
    sellerName: '滴滴出行科技有限公司',
    sellerTaxNo: '91120116MA05XXXX67',
    category: '交通',
    itemName: '运输服务*客运服务费',
    amount: 128.0,
    taxRate: '9%',
    taxAmount: 11.52,
    totalAmount: 139.52,
    checkCode: '0912 7745 1180 3341',
    remark: '客户拜访往返用车',
  },
  {
    kind: 'flight_itinerary',
    invoiceType: '航空运输电子客票行程单',
    invoiceCode: '',
    invoiceNumber: '7842291876340',
    invoiceDate: '2026-10-09',
    sellerName: '中国南方航空股份有限公司',
    sellerTaxNo: '914400001000127871',
    category: '交通',
    itemName: '航空运输服务*客票款',
    amount: 1180.0,
    taxRate: '9%',
    taxAmount: 106.2,
    totalAmount: 1286.2,
    checkCode: '',
    remark: '深圳 - 上海 单程',
  },
  {
    kind: 'vat_special',
    invoiceType: '增值税电子专用发票',
    invoiceCode: '044031900223',
    invoiceNumber: '10034218',
    invoiceDate: '2026-10-10',
    sellerName: '深圳市优品办公用品有限公司',
    sellerTaxNo: '91440300MA5G7B4D2K',
    category: '日用品食品',
    itemName: '货物*办公用品',
    amount: 460.18,
    taxRate: '13%',
    taxAmount: 59.82,
    totalAmount: 520.0,
    checkCode: '1120 5567 8890 2244',
    remark: '办公耗材采购',
  },
  {
    kind: 'vat_normal',
    invoiceType: '增值税电子普通发票',
    invoiceCode: '044031900111',
    invoiceNumber: '08813902',
    invoiceDate: '2026-10-09',
    sellerName: '深圳市南山智选假日酒店有限公司',
    sellerTaxNo: '91440300MA5D9K8P3M',
    category: '服务',
    itemName: '住宿服务*住宿费',
    amount: 780.0,
    taxRate: '6%',
    taxAmount: 46.8,
    totalAmount: 826.8,
    checkCode: '1009 3345 6678 1120',
    remark: '上海出差住宿 2 晚',
  },
];

/** 发票「消费类型」-> 报销类型 的映射 */
const CATEGORY_TO_EXPENSE_TYPE = {
  餐饮: '招待费',
  交通: '差旅费',
  服务: '差旅费',
  日用品食品: '办公用品',
  电器设备: '办公用品',
  通讯: '办公用品',
  医疗: '其他',
  其他: '其他',
};

export { BUYER, invoices, CATEGORY_TO_EXPENSE_TYPE };
