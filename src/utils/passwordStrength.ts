// กติกาความแข็งแรงของรหัสผ่าน — แหล่งความจริงเดียวของทั้งระบบ
// ต้องตรวจฝั่ง server เสมอ เพราะการตรวจในหน้าเว็บอย่างเดียวเลี่ยงได้ด้วยการยิง API ตรง
// (ต้องตรงกับ checklist ที่แสดงในหน้าเปลี่ยนรหัสผ่านและหน้าจัดการบัญชี)

export const PASSWORD_MIN_LENGTH = 8;

export interface PasswordRule {
    key: string;
    label: string;
    test: (v: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
    { key: 'len',     label: `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`, test: v => v.length >= PASSWORD_MIN_LENGTH },
    { key: 'upper',   label: 'มีตัวอักษรพิมพ์ใหญ่ (A-Z)',                test: v => /[A-Z]/.test(v) },
    { key: 'lower',   label: 'มีตัวอักษรพิมพ์เล็ก (a-z)',                 test: v => /[a-z]/.test(v) },
    { key: 'number',  label: 'มีตัวเลข (0-9)',                           test: v => /[0-9]/.test(v) },
    { key: 'special', label: 'มีอักขระพิเศษ (!@#$%^&*)',                 test: v => /[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>/?]/.test(v) },
];

export interface PasswordCheck {
    ok: boolean;
    failed: string[];   // label ของกฎที่ไม่ผ่าน
    message: string;    // ข้อความรวมสำหรับตอบกลับผู้ใช้
}

// ตรวจรหัสผ่านตามกติกา + กันตั้งเป็นข้อมูลที่เดาได้ง่าย (เลขบัตร / ชื่อผู้ใช้)
export function checkPassword(password: string, opts?: { idCard?: string | null; username?: string | null }): PasswordCheck {
    const v = String(password ?? '');
    const failed = PASSWORD_RULES.filter(r => !r.test(v)).map(r => r.label);

    const idCard = String(opts?.idCard ?? '').trim();
    if (idCard && v === idCard) failed.push('ต้องไม่เป็นเลขบัตรประชาชน');

    const username = String(opts?.username ?? '').trim();
    if (username && v.toLowerCase() === username.toLowerCase()) failed.push('ต้องไม่เป็นชื่อผู้ใช้');

    return {
        ok: failed.length === 0,
        failed,
        message: failed.length === 0 ? '' : `รหัสผ่านไม่ผ่านเกณฑ์: ${failed.join(' · ')}`,
    };
}
