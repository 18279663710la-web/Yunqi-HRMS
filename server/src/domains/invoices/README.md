# invoices 目录说明

## 职责

发票识别、查重、查验、上传记录及腾讯云查验适配。

## 主要内容

- 主要文件：`invoiceService.ts`、`invoiceUploadRepository.ts`、`tencentInvoiceVerifier.ts`。

## 维护约束

维护本领域业务规则或数据访问；复用现有事务与领域能力，不把本端专用接口混入共享实现。

## 相关文档

[项目架构约束](../../../../AGENTS.md)、[模块约束](../../../AGENTS.md)、[项目目录职责总览](../../../../docs/项目目录职责说明.md)。
