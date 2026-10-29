// ── ค่าตั้งของระบบลาที่มาจาก env ─────────────────────────────────────────────

/** ยื่นลาล่วงหน้าได้ไม่เกินกี่วันนับจากวันนี้ (LEAVE_MAX_ADVANCE_DAYS, ค่าเริ่มต้น 300) */
export const maxAdvanceDays = (): number => {
    const n = Number(process.env.LEAVE_MAX_ADVANCE_DAYS);
    return Number.isInteger(n) && n > 0 ? n : 300;
};

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) บวก/ลบได้ — เซิร์ฟเวอร์อาจตั้งเขตเวลาเป็น UTC */
export const bangkokDate = (offsetDays = 0): string =>
    new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

export const getLeaveRules = () => ({ success: true, data: { max_advance_days: maxAdvanceDays(), today: bangkokDate() } });
