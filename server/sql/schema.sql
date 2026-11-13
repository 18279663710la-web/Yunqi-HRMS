-- ============================================================
-- 云启科技 · 企业办公小程序 —— MySQL 结构
-- 目标库：yunqi_office（由 server 启动时自动创建）
-- 字符集：utf8mb4（中文 + emoji）
-- 说明：演示项目不建外键，关联一致性由 service 层保证，
--       便于「重置演示数据」时按表清理与重新播种。
-- ============================================================

CREATE TABLE IF NOT EXISTS `companies` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `short_name` VARCHAR(50) NOT NULL,
  `logo_text` VARCHAR(20) NOT NULL,
  `address` VARCHAR(255) NOT NULL,
  `work_time` VARCHAR(50) NOT NULL,
  `flexible` VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `departments` (
  `id` VARCHAR(10) PRIMARY KEY,
  `parent_id` VARCHAR(10) NULL,
  `name` VARCHAR(50) NOT NULL,
  `leader_id` VARCHAR(10) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  KEY `idx_departments_parent` (`parent_id`),
  KEY `idx_departments_leader` (`leader_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `job_titles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL,
  UNIQUE KEY `uk_job_titles_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `legacy_department_names` (
  `id` VARCHAR(10) PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_legacy_job_titles` (
  `item_id` BIGINT NOT NULL PRIMARY KEY,
  `position` VARCHAR(100) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `employees` (
  `id` VARCHAR(10) PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL,
  `pinyin` VARCHAR(100) NOT NULL,
  `gender` VARCHAR(10) NULL,
  `dept_id` VARCHAR(10) NOT NULL,
  `position` VARCHAR(100) NOT NULL,
  `job_category` ENUM('研发员','业务员','员工') NULL,
  `level` VARCHAR(20) NOT NULL,
  `employee_no` VARCHAR(30) NOT NULL,
  `phone` VARCHAR(20) NOT NULL,
  `email` VARCHAR(100) NOT NULL,
  `join_date` DATE NOT NULL,
  `is_leader` TINYINT(1) NOT NULL DEFAULT 0,
  `seat` VARCHAR(50) NOT NULL,
  `leader_id` VARCHAR(10) NULL,
  KEY `idx_employees_dept` (`dept_id`),
  KEY `idx_employees_leader` (`leader_id`),
  KEY `idx_employees_pinyin` (`pinyin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_employee_bindings` (
  `employee_id` VARCHAR(10) NOT NULL PRIMARY KEY,
  `operator_id` VARCHAR(32) NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_u9_operator` (`operator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- U9 回款通知轮询起点；首次启动写入，避免补发历史收款单
CREATE TABLE IF NOT EXISTS `u9_receipt_sync` (
  `id` TINYINT NOT NULL PRIMARY KEY,
  `started_at` DATE NOT NULL,
  `last_poll_at` DATETIME NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 业务员回款留单；明细保存 U9 邮件模板所需的快照字段
CREATE TABLE IF NOT EXISTS `receipt_notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `u9_receipt_id` VARCHAR(32) NOT NULL,
  `employee_id` VARCHAR(10) NOT NULL,
  `operator_id` VARCHAR(32) NOT NULL,
  `doc_no` VARCHAR(50) NOT NULL,
  `customer_name` VARCHAR(255) NOT NULL,
  `business_date` DATE NOT NULL,
  `total_amount` VARCHAR(60) NOT NULL,
  `org_name` VARCHAR(100) NOT NULL,
  `lines_json` JSON NOT NULL,
  `line_count` INT NOT NULL DEFAULT 0,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `read_at` DATETIME NULL,
  `push_status` ENUM('pending','pushed','skipped','failed') NOT NULL DEFAULT 'pending',
  `pushed_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_receipt_notification` (`u9_receipt_id`, `employee_id`),
  KEY `idx_receipt_notification_employee` (`employee_id`, `is_read`, `business_date`),
  KEY `idx_receipt_notification_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_types` (
  `key` VARCHAR(20) PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `description` VARCHAR(100) NOT NULL,
  `fields_json` JSON NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_settings` (
  `setting_key` VARCHAR(40) PRIMARY KEY,
  `value_json` JSON NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `fields_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_self_onboarding` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `expected_date` DATE NOT NULL,
  `template_json` JSON NOT NULL,
  `answers_json` JSON NULL,
  `created_at` DATETIME NOT NULL,
  `submitted_at` DATETIME NULL,
  `archived_at` DATETIME NULL,
  `archived_by` INT NULL,
  UNIQUE KEY `uk_self_onboarding_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding_attachments` (
  `id` CHAR(36) PRIMARY KEY,
  `onboarding_id` BIGINT NOT NULL,
  `field_key` VARCHAR(255) NOT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `file_size` INT NOT NULL,
  `file_data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_onboarding_attachment_application` (`onboarding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding_form_templates` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL DEFAULT '',
  `fields_json` JSON NOT NULL,
  `version` INT NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding_form_template_history` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `template_id` INT NOT NULL,
  `template_name` VARCHAR(50) NOT NULL,
  `action` ENUM('create','update','delete') NOT NULL,
  `before_json` JSON NULL,
  `after_json` JSON NULL,
  `changes_json` JSON NOT NULL,
  `admin_id` INT NOT NULL,
  `admin_name` VARCHAR(50) NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_onboarding_template_history` (`template_id`, `created_at`),
  KEY `idx_onboarding_template_history_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_self_onboarding_submissions` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `onboarding_id` BIGINT NOT NULL,
  `answers_json` JSON NOT NULL,
  `template_json` JSON NULL,
  `submitted_at` DATETIME NOT NULL,
  `returned_at` DATETIME NOT NULL,
  `admin_id` INT NOT NULL,
  `admin_name` VARCHAR(50) NOT NULL,
  KEY `idx_self_onboarding_submission` (`onboarding_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_self_onboarding_edits` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `onboarding_id` BIGINT NOT NULL,
  `before_json` JSON NOT NULL,
  `after_json` JSON NOT NULL,
  `changes_json` JSON NOT NULL,
  `admin_id` INT NOT NULL,
  `admin_name` VARCHAR(50) NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_self_onboarding_edits` (`onboarding_id`, `created_at`),
  KEY `idx_self_onboarding_edits_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding_tasks` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `onboarding_id` BIGINT NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `description` VARCHAR(500) NOT NULL DEFAULT '',
  `start_date` DATE NULL,
  `end_date` DATE NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `completed` TINYINT(1) NOT NULL DEFAULT 0,
  KEY `idx_onboarding_tasks` (`onboarding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_onboarding_links` (
  `onboarding_id` BIGINT PRIMARY KEY,
  `employee_id` VARCHAR(10) NOT NULL,
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `idx_onboarding_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_employee_history` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `section` VARCHAR(20) NOT NULL,
  `data_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_hr_history` (`employee_id`, `section`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_events` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `event_type` VARCHAR(20) NOT NULL,
  `effective_date` DATE NOT NULL,
  `note` VARCHAR(500) NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_hr_events_employee` (`employee_id`, `effective_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_employee_transitions` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `change_type` ENUM('promotion','transfer') NOT NULL,
  `effective_date` DATE NOT NULL,
  `before_json` JSON NOT NULL,
  `after_json` JSON NOT NULL,
  `note` VARCHAR(500) NOT NULL DEFAULT '',
  `status` ENUM('submitted','cancelled') NOT NULL DEFAULT 'submitted',
  `created_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `cancelled_by` INT NULL,
  `cancelled_at` DATETIME NULL,
  KEY `idx_hr_transitions_employee` (`employee_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_batches` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `payroll_month` CHAR(7) NOT NULL,
  `status` ENUM('draft','reviewed') NOT NULL DEFAULT 'draft',
  `created_at` DATETIME NOT NULL,
  `reviewed_at` DATETIME NULL,
  `reviewed_by` INT NULL,
  KEY `idx_hr_batch_month` (`payroll_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_month_locks` (
  `payroll_month` CHAR(7) NOT NULL PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_batch_items` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `batch_id` BIGINT NOT NULL,
  `employee_id` VARCHAR(10) NOT NULL,
  `gross` DECIMAL(12,2) NOT NULL,
  `base_gross` DECIMAL(12,2) NULL,
  `attendance_rate` DECIMAL(5,2) NULL,
  `attendance_adjustment` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `attendance_snapshot` JSON NULL,
  `overtime_seconds` BIGINT NOT NULL DEFAULT 0,
  `overtime_pay` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `overtime_snapshot` JSON NULL,
  `model_snapshot` JSON NULL,
  `deductions` DECIMAL(12,2) NOT NULL,
  `net` DECIMAL(12,2) NOT NULL,
  `note` VARCHAR(200) NOT NULL,
  UNIQUE KEY `idx_hr_batch_employee` (`batch_id`, `employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_payslip_staging` (
  `batch_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `admin_id` INT NOT NULL,
  `source_revision` CHAR(64) NOT NULL,
  `pdf_data` MEDIUMBLOB NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`batch_id`, `admin_id`, `item_id`),
  KEY `idx_payslip_staging_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_payslips` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `batch_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `employee_id` VARCHAR(10) NOT NULL,
  `pdf_data` MEDIUMBLOB NOT NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `sent_at` DATETIME NOT NULL,
  `sent_by` INT NOT NULL,
  `read_at` DATETIME NULL,
  UNIQUE KEY `uk_hr_payslip_item` (`item_id`),
  KEY `idx_hr_payslip_employee` (`employee_id`, `sent_at`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_disbursement_fields` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `batch_id` BIGINT NOT NULL,
  `name` VARCHAR(60) NOT NULL,
  `category` ENUM('income','deduction','info') NOT NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `display_setting` ENUM('none','display','output') NOT NULL DEFAULT 'none',
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `idx_hr_disbursement_field_name` (`batch_id`, `name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_disbursement_values` (
  `field_id` BIGINT NOT NULL,
  `item_id` BIGINT NOT NULL,
  `value` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `revision` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL,
  `updated_by` INT NOT NULL,
  PRIMARY KEY (`field_id`, `item_id`),
  KEY `idx_hr_disbursement_value_item` (`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_disbursement_records` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `batch_id` BIGINT NOT NULL,
  `payroll_month` CHAR(7) NOT NULL,
  `gross_total` DECIMAL(18,2) NOT NULL,
  `net_total` DECIMAL(18,2) NOT NULL,
  `note` VARCHAR(200) NOT NULL DEFAULT '',
  `snapshot_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL,
  `created_by` INT NOT NULL,
  UNIQUE KEY `idx_hr_disbursement_record_batch` (`batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_offboarding` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `last_date` DATE NOT NULL,
  `note` VARCHAR(500) NOT NULL,
  `status` ENUM('open','completed') NOT NULL DEFAULT 'open',
  `created_at` DATETIME NOT NULL,
  KEY `idx_hr_offboarding_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_offboarding_tasks` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `offboarding_id` BIGINT NOT NULL,
  `title` VARCHAR(100) NOT NULL,
  `required` TINYINT(1) NOT NULL DEFAULT 1,
  `completed` TINYINT(1) NOT NULL DEFAULT 0,
  KEY `idx_hr_offboarding_tasks` (`offboarding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_employee_departures` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `offboarding_id` BIGINT NOT NULL,
  `employee_id` VARCHAR(10) NOT NULL,
  `last_date` DATE NOT NULL,
  `status` ENUM('departed','cancelled') NOT NULL DEFAULT 'departed',
  `created_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `cancelled_by` INT NULL,
  `cancelled_at` DATETIME NULL,
  UNIQUE KEY `idx_hr_departure_case` (`offboarding_id`),
  KEY `idx_hr_departure_employee` (`employee_id`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_contract_files` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `file_name` VARCHAR(200) NOT NULL,
  `mime_type` VARCHAR(100) NOT NULL,
  `file_size` INT UNSIGNED NOT NULL,
  `file_data` LONGBLOB NOT NULL,
  `uploaded_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_contract_files_employee` (`employee_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_employee_records` (
  `employee_id` VARCHAR(10) NOT NULL,
  `section` VARCHAR(20) NOT NULL,
  `data_json` JSON NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`employee_id`, `section`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `hr_payroll_records` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `batch_id` BIGINT NULL,
  `payroll_month` CHAR(7) NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `note` VARCHAR(200) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `idx_hr_payroll_employee_month` (`employee_id`, `payroll_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_approvers` (
  `type` VARCHAR(20) PRIMARY KEY,
  `employee_id` VARCHAR(10) NOT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_rules` (
  `type` VARCHAR(20) PRIMARY KEY,
  `content` TEXT NOT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_approval_workflows` (
  `approval_type` VARCHAR(20) PRIMARY KEY,
  `version` INT NOT NULL DEFAULT 0,
  `graph_json` JSON NOT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_approval_test_cases` (
  `approval_type` VARCHAR(20) PRIMARY KEY,
  `version` INT NOT NULL DEFAULT 0,
  `cases_json` JSON NOT NULL,
  `updated_by` INT NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_approval_test_runs` (
  `approval_type` VARCHAR(20) PRIMARY KEY,
  `workflow_version` INT NOT NULL,
  `case_version` INT NOT NULL,
  `fields_hash` CHAR(64) NOT NULL,
  `passed` TINYINT(1) NOT NULL,
  `tested_by` INT NOT NULL,
  `tested_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_approval_publications` (
  `approval_type` VARCHAR(20) PRIMARY KEY,
  `publication_version` INT NOT NULL,
  `workflow_version` INT NOT NULL,
  `case_version` INT NOT NULL,
  `graph_json` JSON NOT NULL,
  `fixed_fields_json` JSON NOT NULL,
  `credentials_json` JSON NOT NULL,
  `published_by` INT NOT NULL,
  `published_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `custom_approval_credentials` (
  `approval_type` VARCHAR(20) NOT NULL,
  `node_id` VARCHAR(100) NOT NULL,
  `encrypted_key` TEXT NOT NULL,
  PRIMARY KEY (`approval_type`, `node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_workflow_instances` (
  `approval_id` VARCHAR(30) PRIMARY KEY,
  `publication_version` INT NOT NULL,
  `outcome` ENUM('approved','rejected') NOT NULL,
  `plan_json` JSON NOT NULL,
  `workflow_json` JSON NOT NULL,
  `credentials_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_workflow_ai_jobs` (
  `approval_id` VARCHAR(30) NOT NULL,
  `step_no` INT NOT NULL,
  `node_id` VARCHAR(100) NOT NULL,
  `status` ENUM('waiting','queued','processing','completed','failed','stopped') NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `input_json` JSON NOT NULL,
  `result_json` JSON NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`approval_id`, `step_no`),
  KEY `idx_workflow_ai_queue` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expense_ai_jobs` (
  `approval_id` VARCHAR(30) PRIMARY KEY,
  `approver_id` VARCHAR(10) NOT NULL,
  `status` ENUM('queued','processing','completed','failed','no_rules') NOT NULL,
  `rules_snapshot` TEXT NOT NULL,
  `input_json` JSON NOT NULL,
  `result_json` JSON NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `updated_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_expense_ai_queue` (`status`, `updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expense_uploads` (
  `file_id` VARCHAR(200) PRIMARY KEY,
  `owner_id` VARCHAR(10) NOT NULL,
  `created_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `expense_attachments` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `approval_id` VARCHAR(30) NOT NULL,
  `file_id` VARCHAR(200) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  KEY `idx_expense_attachment_approval` (`approval_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `chairperson_account` (
  `id` TINYINT PRIMARY KEY,
  `login_name` VARCHAR(30) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `quick_actions` (
  `key` VARCHAR(20) PRIMARY KEY,
  `name` VARCHAR(50) NOT NULL,
  `icon` VARCHAR(30) NOT NULL,
  `color` VARCHAR(20) NOT NULL,
  `url` VARCHAR(200) NOT NULL,
  `is_tab` TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order` INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approvals` (
  `id` VARCHAR(30) PRIMARY KEY,
  `type` VARCHAR(20) NOT NULL,
  `type_name` VARCHAR(50) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `status` ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  `urgent` TINYINT(1) NOT NULL DEFAULT 0,
  `applicant_id` VARCHAR(10) NOT NULL,
  `applicant_name` VARCHAR(50) NOT NULL,
  `applicant_dept` VARCHAR(50) NOT NULL,
  `applicant_position` VARCHAR(100) NOT NULL,
  `node` VARCHAR(100) NULL,
  `summary` VARCHAR(500) NULL,
  `form_json` JSON NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NULL,
  KEY `idx_approvals_status` (`status`),
  KEY `idx_approvals_applicant` (`applicant_id`),
  KEY `idx_approvals_sort` (`urgent`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `approval_timeline` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `approval_id` VARCHAR(30) NOT NULL,
  `step_no` INT NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `role` VARCHAR(50) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `comment` VARCHAR(200) NULL,
  `time_text` VARCHAR(20) NULL,
  `state` ENUM('done','current','wait','reject','stop') NOT NULL DEFAULT 'wait',
  `approver_id` VARCHAR(10) NULL,
  KEY `idx_timeline_approval` (`approval_id`, `step_no`),
  KEY `idx_timeline_approver` (`approver_id`, `state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `id` VARCHAR(60) PRIMARY KEY,
  `approval_id` VARCHAR(30) NULL,
  `invoice_key` VARCHAR(80) NULL,
  `source` VARCHAR(10) NOT NULL DEFAULT 'image',
  `file_id` VARCHAR(500) NULL,
  `invoice_type` VARCHAR(100) NOT NULL DEFAULT '',
  `invoice_code` VARCHAR(30) NOT NULL DEFAULT '',
  `invoice_number` VARCHAR(40) NOT NULL DEFAULT '',
  `invoice_date` VARCHAR(20) NOT NULL DEFAULT '',
  `seller_name` VARCHAR(200) NOT NULL DEFAULT '',
  `seller_tax_no` VARCHAR(50) NOT NULL DEFAULT '',
  `buyer_name` VARCHAR(200) NOT NULL DEFAULT '',
  `category` VARCHAR(30) NOT NULL DEFAULT '',
  `item_name` VARCHAR(200) NOT NULL DEFAULT '',
  `amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `tax_rate` VARCHAR(20) NOT NULL DEFAULT '',
  `tax_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `total_amount` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `check_code` VARCHAR(50) NOT NULL DEFAULT '',
  `remark` VARCHAR(255) NOT NULL DEFAULT '',
  `is_mock` TINYINT(1) NOT NULL DEFAULT 0,
  `is_qr` TINYINT(1) NOT NULL DEFAULT 0,
  `qr_from` VARCHAR(10) NOT NULL DEFAULT '',
  `qr_crc_verified` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  KEY `idx_invoices_approval` (`approval_id`),
  KEY `idx_invoices_key` (`invoice_key`),
  KEY `idx_invoices_number` (`invoice_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 每个发票标识作为事务互斥锁，历史发票仍保存在 invoices 中。
CREATE TABLE IF NOT EXISTS `invoice_identity_locks` (
  `invoice_key` VARCHAR(80) PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_punches` (
  `employee_id` VARCHAR(10) NOT NULL,
  `punch_date` DATE NOT NULL,
  `check_in` CHAR(5) NULL,
  `check_out` CHAR(5) NULL,
  `status_override` ENUM('leave','absent','rest') NULL,
  `note` VARCHAR(200) NULL,
  `source` ENUM('employee','admin','seed') NOT NULL DEFAULT 'employee',
  `updated_by_admin_id` INT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`employee_id`, `punch_date`),
  KEY `idx_attendance_date` (`punch_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `attendance_overtime_punches` (
  `approval_id` VARCHAR(30) NOT NULL PRIMARY KEY,
  `employee_id` VARCHAR(10) NOT NULL,
  `check_in` DATETIME NOT NULL,
  `check_out` DATETIME NULL,
  KEY `idx_overtime_employee_start` (`employee_id`, `check_in`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 拜访记录：员工在客户现场单次签到，仅用于记录和统计，不改变考勤状态。
CREATE TABLE IF NOT EXISTS `attendance_visits` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `employee_id` VARCHAR(10) NOT NULL,
  `visit_time` DATETIME NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `purpose` VARCHAR(200) NOT NULL,
  `address_name` VARCHAR(100) NOT NULL DEFAULT '',
  `address` VARCHAR(255) NOT NULL,
  `latitude` DECIMAL(10,7) NOT NULL,
  `longitude` DECIMAL(10,7) NOT NULL,
  `accuracy` INT NULL,
  `remark` VARCHAR(500) NOT NULL DEFAULT '',
  `photo_count` TINYINT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_attendance_visits_employee_time` (`employee_id`, `visit_time`),
  KEY `idx_attendance_visits_time` (`visit_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 拜访现场照片：visit_id 为空表示已上传但尚未提交的临时照片。
CREATE TABLE IF NOT EXISTS `attendance_visit_photos` (
  `id` CHAR(36) NOT NULL PRIMARY KEY,
  `employee_id` VARCHAR(10) NOT NULL,
  `visit_id` BIGINT NULL,
  `file_name` VARCHAR(255) NOT NULL,
  `mime_type` VARCHAR(50) NOT NULL,
  `file_size` INT NOT NULL,
  `file_data` LONGBLOB NOT NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_attendance_visit_photos_visit` (`visit_id`),
  KEY `idx_attendance_visit_photos_employee` (`employee_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- start_time/end_time 分别是上班卡、下班卡时间段的开始，均可自由设置。
CREATE TABLE IF NOT EXISTS `attendance_settings` (
  `id` INT PRIMARY KEY,
  `start_time` CHAR(5) NOT NULL,
  `in_end_time` CHAR(5) NULL,
  `end_time` CHAR(5) NOT NULL,
  `out_end_time` CHAR(5) NULL,
  `rest_dates` JSON NULL,
  `latitude` DECIMAL(10,7) NOT NULL,
  `longitude` DECIMAL(10,7) NOT NULL,
  `radius` INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 各考勤组独立保存打卡规则；start_time/end_time 分别是上班卡、下班卡时间段的开始。
CREATE TABLE IF NOT EXISTS `attendance_groups` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL,
  `calendar_rule_id` INT NULL,
  `start_time` CHAR(5) NOT NULL,
  `in_end_time` CHAR(5) NOT NULL,
  `end_time` CHAR(5) NOT NULL,
  `out_end_time` CHAR(5) NOT NULL,
  `rest_dates` JSON NULL,
  `latitude` DECIMAL(10,7) NOT NULL,
  `longitude` DECIMAL(10,7) NOT NULL,
  `radius` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_group_name` (`name`),
  KEY `idx_attendance_group_calendar` (`calendar_rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 公司日历：可创建多条作息规则，考勤组选择其一；例外休息/上班日期优先于默认规则。
CREATE TABLE IF NOT EXISTS `company_calendar_rules` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL,
  `mode` ENUM('none','weekly','cycle') NOT NULL DEFAULT 'none',
  `weekly_rest_days` JSON NULL,
  `cycle_weeks` INT NULL,
  `cycle_rest_days` JSON NULL,
  `anchor_date` DATE NULL,
  `rest_dates` JSON NULL,
  `work_dates` JSON NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_company_calendar_rule_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 同一员工只归属一个考勤组；未出现在此表中的员工使用默认考勤设置。
CREATE TABLE IF NOT EXISTS `attendance_group_employees` (
  `employee_id` VARCHAR(10) NOT NULL,
  `group_id` INT NOT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`employee_id`),
  KEY `idx_attendance_group` (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notices` (
  `id` VARCHAR(20) PRIMARY KEY,
  `title` VARCHAR(255) NOT NULL,
  `category` VARCHAR(20) NOT NULL,
  `category_name` VARCHAR(50) NOT NULL,
  `is_top` TINYINT(1) NOT NULL DEFAULT 0,
  `publish_time` DATETIME NOT NULL,
  `publisher` VARCHAR(50) NOT NULL,
  `publisher_dept` VARCHAR(50) NOT NULL,
  `banner` VARCHAR(100) NOT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `read_count` INT NOT NULL DEFAULT 0,
  `total_count` INT NOT NULL DEFAULT 0,
  `blocks_json` JSON NOT NULL,
  `attachments_json` JSON NOT NULL,
  KEY `idx_notices_sort` (`is_top`, `publish_time`),
  KEY `idx_notices_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notice_reads` (
  `notice_id` VARCHAR(20) NOT NULL,
  `employee_id` VARCHAR(10) NOT NULL,
  `read_at` DATETIME NOT NULL,
  PRIMARY KEY (`notice_id`, `employee_id`),
  KEY `idx_notice_reads_employee` (`employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 查验结果缓存：同一张票全生命周期只查一次（README 第七节的上线建议）
CREATE TABLE IF NOT EXISTS `invoice_verifications` (
  `invoice_key` VARCHAR(80) PRIMARY KEY,
  `status` VARCHAR(20) NOT NULL,
  `message` VARCHAR(255) NOT NULL,
  `invoice_json` JSON NULL,
  `mock` TINYINT(1) NOT NULL DEFAULT 0,
  `verified_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `app_meta` (
  `k` VARCHAR(50) PRIMARY KEY,
  `v` VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Web 管理后台
-- ============================================================

-- 管理员账号（后台登录用，与员工账号分离）
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT PRIMARY KEY AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(50) NOT NULL,
  `role` ENUM('super_admin','hr_admin') NOT NULL DEFAULT 'hr_admin',
  `status` TINYINT(1) NOT NULL DEFAULT 1,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_admins_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 员工登录账号（供小程序 / 后续统一认证使用）
CREATE TABLE IF NOT EXISTS `employee_accounts` (
  `employee_id` VARCHAR(10) PRIMARY KEY,
  `login_name` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `last_login_at` DATETIME NULL,
  `created_by` INT NULL,
  `created_at` DATETIME NOT NULL,
  `updated_at` DATETIME NOT NULL,
  UNIQUE KEY `uk_employee_accounts_login` (`login_name`),
  KEY `idx_employee_accounts_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `employee_session_versions` (
  `employee_id` VARCHAR(10) PRIMARY KEY,
  `version` INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 管理后台操作审计
CREATE TABLE IF NOT EXISTS `admin_operation_logs` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `admin_id` INT NOT NULL,
  `admin_name` VARCHAR(50) NOT NULL,
  `action` VARCHAR(50) NOT NULL,
  `target_type` VARCHAR(30) NOT NULL,
  `target_id` VARCHAR(50) NOT NULL,
  `detail_json` JSON NULL,
  `created_at` DATETIME NOT NULL,
  KEY `idx_admin_logs_created` (`created_at`),
  KEY `idx_admin_logs_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- U9 只读镜像：员工查询读此库表，U9 SQL Server 仅由限流抽取器访问
CREATE TABLE IF NOT EXISTS `u9_mirror_operators` (
  `id` VARCHAR(32) NOT NULL PRIMARY KEY,
  `code` VARCHAR(50) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `org_id` VARCHAR(32) NOT NULL,
  `org_name` VARCHAR(100) NOT NULL DEFAULT '',
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_operators_code` (`code`),
  KEY `idx_u9_mirror_operators_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_ar_heads` (
  `id` VARCHAR(32) NOT NULL PRIMARY KEY,
  `doc_no` VARCHAR(50) NOT NULL,
  `customer_id` VARCHAR(32) NOT NULL DEFAULT '',
  `customer_name` VARCHAR(255) NOT NULL DEFAULT '',
  `business_date` DATE NOT NULL,
  `post_period` VARCHAR(20) NOT NULL DEFAULT '',
  `src_org` VARCHAR(100) NOT NULL DEFAULT '',
  `invoice_date` DATE NULL,
  `invoice_num` VARCHAR(500) NOT NULL DEFAULT '',
  `currency_name` VARCHAR(50) NOT NULL DEFAULT '',
  `currency_precision` INT NOT NULL DEFAULT 2,
  `doc_status` INT NOT NULL DEFAULT 0,
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_ar_heads_date` (`business_date`),
  KEY `idx_u9_mirror_ar_heads_period` (`post_period`),
  KEY `idx_u9_mirror_ar_heads_customer` (`customer_id`),
  KEY `idx_u9_mirror_ar_heads_doc` (`doc_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_ar_lines` (
  `id` VARCHAR(32) NOT NULL PRIMARY KEY,
  `doc_id` VARCHAR(32) NOT NULL,
  `seller_operator_id` VARCHAR(32) NOT NULL,
  `line_num` INT NOT NULL,
  `src_ship_no` VARCHAR(50) NOT NULL DEFAULT '',
  `src_line_num` INT NOT NULL DEFAULT 0,
  `item_name` VARCHAR(255) NOT NULL DEFAULT '',
  `item_code` VARCHAR(80) NOT NULL DEFAULT '',
  `uom` VARCHAR(50) NOT NULL DEFAULT '',
  `qty` VARCHAR(50) NOT NULL DEFAULT '0',
  `non_tax_price` VARCHAR(50) NOT NULL DEFAULT '0',
  `tax_price` VARCHAR(50) NOT NULL DEFAULT '0',
  `non_tax_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `tax_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `tax_included_total` VARCHAR(60) NOT NULL DEFAULT '0',
  `total_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `total_balance` VARCHAR(60) NOT NULL DEFAULT '0',
  `own_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `biz_org` VARCHAR(100) NOT NULL DEFAULT '',
  `maturity` DATE NULL,
  `line_status` VARCHAR(20) NOT NULL DEFAULT '',
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_ar_lines_doc` (`doc_id`),
  KEY `idx_u9_mirror_ar_lines_seller` (`seller_operator_id`, `doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_rec_heads` (
  `id` VARCHAR(32) NOT NULL PRIMARY KEY,
  `doc_no` VARCHAR(50) NOT NULL,
  `customer_id` VARCHAR(32) NOT NULL DEFAULT '',
  `customer_name` VARCHAR(255) NOT NULL DEFAULT '',
  `business_date` DATE NOT NULL,
  `post_period` VARCHAR(20) NOT NULL DEFAULT '',
  `org_id` VARCHAR(32) NOT NULL DEFAULT '',
  `org_code` VARCHAR(50) NOT NULL DEFAULT '',
  `org_name` VARCHAR(100) NOT NULL DEFAULT '',
  `transactor_id` VARCHAR(32) NOT NULL DEFAULT '',
  `total_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `currency_name` VARCHAR(50) NOT NULL DEFAULT '',
  `currency_precision` INT NOT NULL DEFAULT 2,
  `doc_status` INT NOT NULL DEFAULT 0,
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_rec_heads_date` (`business_date`),
  KEY `idx_u9_mirror_rec_heads_period` (`post_period`),
  KEY `idx_u9_mirror_rec_heads_customer` (`customer_id`),
  KEY `idx_u9_mirror_rec_heads_transactor` (`transactor_id`),
  KEY `idx_u9_mirror_rec_heads_org` (`org_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_rec_lines` (
  `id` VARCHAR(32) NOT NULL PRIMARY KEY,
  `doc_id` VARCHAR(32) NOT NULL,
  `line_num` INT NOT NULL,
  `settlement_method` VARCHAR(100) NOT NULL DEFAULT '',
  `note_no` VARCHAR(100) NOT NULL DEFAULT '',
  `amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `bank_account` VARCHAR(255) NOT NULL DEFAULT '',
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_rec_lines_doc` (`doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 收款单按出货明细业务员归属；同一收款单可对应多名业务员
CREATE TABLE IF NOT EXISTS `u9_mirror_rec_sellers` (
  `doc_id` VARCHAR(32) NOT NULL,
  `seller_operator_id` VARCHAR(32) NOT NULL,
  `own_amount` VARCHAR(60) NOT NULL DEFAULT '0',
  `synced_at` DATETIME NOT NULL,
  PRIMARY KEY (`doc_id`, `seller_operator_id`),
  KEY `idx_u9_mirror_rec_sellers_op` (`seller_operator_id`, `doc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_summary_rows` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `operator_id` VARCHAR(32) NOT NULL,
  `from_period` VARCHAR(20) NOT NULL,
  `to_period` VARCHAR(20) NOT NULL,
  `customer_code` VARCHAR(50) NOT NULL DEFAULT '',
  `customer_name` VARCHAR(255) NOT NULL DEFAULT '',
  `ar_term` VARCHAR(255) NOT NULL DEFAULT '',
  `saleser` VARCHAR(255) NOT NULL DEFAULT '',
  `row_num` BIGINT NOT NULL DEFAULT 0,
  `display_name` VARCHAR(50) NOT NULL DEFAULT '',
  `un_rec_money` VARCHAR(60) NOT NULL DEFAULT '0',
  `currency_name` VARCHAR(50) NOT NULL DEFAULT '-',
  `money_precision` INT NOT NULL DEFAULT 2,
  `synced_at` DATETIME NOT NULL,
  KEY `idx_u9_mirror_summary_op_range` (`operator_id`, `from_period`, `to_period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_sync_state` (
  `id` TINYINT NOT NULL PRIMARY KEY,
  `watermark_date` DATE NULL,
  `last_success_at` DATETIME NULL,
  `last_mode` VARCHAR(20) NULL,
  `updated_at` DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `u9_mirror_sync_runs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `mode` VARCHAR(20) NOT NULL,
  `started_at` DATETIME NOT NULL,
  `finished_at` DATETIME NULL,
  `success` TINYINT(1) NULL,
  `error_message` VARCHAR(500) NULL,
  `stats_json` JSON NULL,
  KEY `idx_u9_mirror_sync_runs_started` (`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
