// ประเภทบุคลากรที่ชื่อตำแหน่งทางการต้องต่อท้ายด้วยระดับ (user_types: 1 = ข้าราชการ, 3 = ลูกจ้างประจำ)
const LEVELED_TYPES = [1, 3];

/**
 * ชื่อตำแหน่งแบบทางการ — ข้าราชการ / ลูกจ้างประจำ ต่อระดับท้ายตำแหน่ง
 * ระดับที่เป็นคำ (ชำนาญการ) ต่อติดกัน · ระดับแบบรหัส (ช 2, บ 3) เว้นวรรค
 */
export const positionWithLevel = (positionName: unknown, levelName: unknown, userTypeId: unknown): string => {
    const position = String(positionName ?? '').trim();
    const level = String(levelName ?? '').trim();
    const withLevel = LEVELED_TYPES.includes(Number(userTypeId)) && level && level !== '-' && position;
    return withLevel ? `${position}${/\d/.test(level) ? ' ' : ''}${level}` : position;
};
