// ── เติมข้อมูลย้อนหลังให้ใบลาที่โอนจากโปรแกรมเดิมไปก่อนแล้ว ─────────────────────
// ประวัติการอนุมัติ (วันที่/ผู้อนุมัติ/ความเห็น) ที่ติดต่อระหว่างลา ผู้ปฏิบัติหน้าที่แทน และชื่อไฟล์แนบ (file_sick) — เติมเฉพาะส่วนที่ยังว่าง รันซ้ำได้
// ตรรกะอยู่ที่ services/legacyImport.ts (การโอนครั้งต่อไปใส่ข้อมูลเหล่านี้ให้เองแล้ว)
//
//   bun src/scripts/backfillLegacyLeaveDetails.ts            ทดลอง (ไม่เขียนข้อมูล)
//   bun src/scripts/backfillLegacyLeaveDetails.ts --commit   บันทึกจริง
import { backfillLegacyDetails } from '../services/legacyImport';

await backfillLegacyDetails({ commit: process.argv.includes('--commit') }, line => console.log(line));
process.exit(0);
