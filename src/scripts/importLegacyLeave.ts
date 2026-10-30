// ── โอนประวัติการลาจากโปรแกรมเดิม (MySQL DB_LEAVE_*) เข้าระบบใหม่ ─────────────────
// ตรรกะอยู่ที่ services/legacyImport.ts — งาน HR ใช้หน้า /hr/leave/legacy-import แทนสคริปต์นี้ได้
//
//   bun src/scripts/importLegacyLeave.ts --fy=2570 --name="ชื่อ สกุล"            ทดลอง (ไม่เขียนข้อมูล)
//   bun src/scripts/importLegacyLeave.ts --fy=2570 --user=4 --commit             โอนจริงเฉพาะคน
//   bun src/scripts/importLegacyLeave.ts --fy=2570 --mission=7 --commit          โอนทั้งกลุ่มภารกิจ (missions.mission_id)
//   bun src/scripts/importLegacyLeave.ts --fy=2570 --all --commit                โอนทุกคน
//   bun src/scripts/importLegacyLeave.ts --fy=2570 --user=4 --undo --commit      ถอนที่โอนไปแล้ว
import { runLegacyLeaveImport, type LeaveImportOptions } from '../services/legacyImport';

const arg = (k: string) => process.argv.find(a => a === `--${k}` || a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? null;
const has = (k: string) => process.argv.includes(`--${k}`);

if (has('help') || !arg('fy')) {
    console.log('ใช้: bun src/scripts/importLegacyLeave.ts --fy=2570 (--user=<users.id> | --name="ชื่อ สกุล" | --mission=<mission_id> | --all) [--commit] [--undo]');
    process.exit(has('help') ? 0 : 1);
}
const scope: LeaveImportOptions['scope'] | null =
    has('all') ? 'all' : arg('user') ? 'user' : arg('mission') ? 'mission' : arg('name') ? 'name' : null;
if (!scope) { console.log('ระบุ --user, --name, --mission หรือ --all'); process.exit(1); }

await runLegacyLeaveImport({
    fy: Number(arg('fy')), scope, commit: has('commit'), undo: has('undo'),
    userId: Number(arg('user')), missionId: Number(arg('mission')), name: arg('name') ?? undefined,
}, line => console.log(line));
process.exit(0);
