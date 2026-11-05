# Frappe HR 业务对照及许可

- 上游项目：[frappe/hrms](https://github.com/frappe/hrms)，Frappe Technologies Pvt. Ltd. 及贡献者。
- 本阶段对照版本：v16.52.0，提交 `5c72c067c0a3bcc969a49c708b7bec545a046fe9`。
- 上游许可：GNU General Public License v3.0，完整文本见本目录 `LICENSE.txt`；各文件原始版权声明以对应上游源码为准。
- 人事异动实现参考上游 `hrms/hr/doctype/employee_promotion/employee_promotion.py` 和 `hrms/hr/doctype/employee_transfer/employee_transfer.py`，对应“生效日期到达后提交、更新员工资料、撤销时恢复资料”的业务行为。
- 本项目使用自己的 TypeScript、Express 和 MySQL 数据模型；目前仅支持岗位、职级、职位分类及部门的即时异动，已确认离职的员工不能提交异动。为保护后续数据，撤销须先撤销较晚的异动，并检查当前值是否仍与异动后快照一致。新员工编号、跨公司调动、薪资修订、完整雇佣状态校验和全部上游细节尚未实现。
- 入职进度参考上游 `hrms/controllers/employee_boarding_controller.py` 和 `hrms/hr/doctype/employee_onboarding/employee_onboarding.py`：任务进度与员工建档分离，必需任务完成后允许建档，其他任务继续办理。模板说明、开始偏移及持续天数随任务复制；起止日期分别从活动开始日计算并顺延休息日。休息日使用本项目考勤设置的日期，并非上游按员工或入职单选择的假日历；本项目暂不支持上游任务权重、负责人、通知和文档提交/取消机制。
- 离职清单参考上游 `hrms/hr/doctype/employee_separation/employee_separation.py`。正式确认离职、指定审批人及待处理单据检查、账号撤销和考勤截止是结合本项目规则实现的扩展，不声称与上游完全一致。
- 上游项目及依赖的其他文件可能有不同声明；未来复制或移植其他源码时需逐文件记录来源并检查其许可。软件对外分发前应根据实际组合和交付方式审查许可证义务。
