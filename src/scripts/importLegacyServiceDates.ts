// ── โอนวันบรรจุ (tb_employee.appoint_date) จากโปรแกรมการลาเดิม → hr_leave_service_dates ─────
// ตรรกะอยู่ที่ services/legacyImport.ts — งาน HR ใช้หน้า /hr/leave/legacy-import แทนสคริปต์นี้ได้
//
//   bun src/scripts/importLegacyServiceDates.ts                                ทดลอง (ไม่เขียน) แสดงสรุป
//   bun src/scripts/importLegacyServiceDates.ts --commit                       บันทึกจริง (รันซ้ำได้)
//   bun src/scripts/importLegacyServiceDates.ts --commit --fill-hire-date      และเติม users.hire_date ที่ยังว่าง (ไม่เขียนทับ)
import { runLegacyServiceDates } from '../services/legacyImport';

const r = await runLegacyServiceDates(
    { commit: process.argv.includes('--commit'), fillHireDate: process.argv.includes('--fill-hire-date') },
    line => console.log(line),
);
if (process.env.FILLED_IDS_OUT && r.filled_ids) await Bun.write(process.env.FILLED_IDS_OUT, JSON.stringify(r.filled_ids));
process.exit(0);
