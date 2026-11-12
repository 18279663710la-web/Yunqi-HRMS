import { transaction } from './pool';

/**
 * 工作台快捷入口：将旧的“公告通知”替换为“拜访登记”。
 * 公告仍可从工作台“最新公告”和公告页面访问，因此只调整快捷入口。
 */
export async function migrateVisitQuickAction(): Promise<void> {
  await transaction(async (conn) => {
    const [marker] = await conn.execute<any[]>("SELECT 1 FROM app_meta WHERE `k` = 'visit_quick_action_v1' LIMIT 1");
    if (marker.length) return;
    await conn.execute(
      `INSERT INTO quick_actions (\`key\`, name, icon, color, url, is_tab, sort_order)
       VALUES ('visit', '拜访登记', 'visit', '#0BA5EC', '/pages/visit/visit', 0, 3)
       ON DUPLICATE KEY UPDATE name = VALUES(name), icon = VALUES(icon), color = VALUES(color), url = VALUES(url), is_tab = 0`
    );
    await conn.execute("DELETE FROM quick_actions WHERE `key` = 'notice'");
    await conn.execute("INSERT INTO app_meta (`k`, `v`) VALUES ('visit_quick_action_v1', '1') ON DUPLICATE KEY UPDATE `v` = VALUES(`v`)");
  });
}
