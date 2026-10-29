import { networkInterfaces } from 'os';

// IP จริงของผู้ใช้
// request ส่วนใหญ่มาผ่าน Next.js server (API proxy) ทำให้ IP ต้นทางเป็นของเครื่อง frontend เสมอ
// Next.js ส่ง IP ผู้ใช้มาใน X-Forwarded-For — เชื่อ header นี้เฉพาะเมื่อต้นทางเป็น proxy ที่ไว้ใจได้
// (ไม่งั้นใครยิงตรงมาที่ backend ก็ปลอม IP ได้)
// ค่าตั้งต้น: loopback + IP ของเครื่องนี้เอง (frontend/nginx อยู่เครื่องเดียวกัน)
// ถ้า proxy อยู่เครื่องอื่น ตั้ง TRUSTED_PROXIES=ip1,ip2 ใน .env
//
// ข้อจำกัด: Next.js ใส่ x-forwarded-for เฉพาะเมื่อ client ไม่ได้ส่งมา (??=) — ผู้ใช้ที่เข้า :5555 ตรง
// ส่ง header นี้เองได้ จึงใช้สำหรับ log / audit เท่านั้น ห้ามใช้เป็น key ของ rate limit หรือการตัดสินสิทธิ์

const normalize = (ip: string) => ip.trim().replace(/^::ffff:/, '');

const localAddresses = () =>
    Object.values(networkInterfaces()).flat()
        .map(i => i?.address)
        .filter((a): a is string => !!a)
        .map(normalize);

const TRUSTED = new Set([
    '127.0.0.1', '::1',
    ...localAddresses(),
    ...(process.env.TRUSTED_PROXIES ?? '').split(',').map(normalize).filter(Boolean),
]);

export const clientIp = (request: Request, server: any): string => {
    const peer = server?.requestIP?.(request)?.address;
    if (!peer) return 'unknown';
    const ip = normalize(peer);
    if (!TRUSTED.has(ip)) return ip;

    // ไล่จากขวา (hop ใกล้สุด) ข้าม proxy ที่ไว้ใจได้ — ตัวแรกที่ไม่ใช่ proxy คือผู้ใช้
    const hops = (request.headers.get('x-forwarded-for') ?? '').split(',').map(normalize).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i--) {
        if (!TRUSTED.has(hops[i])) return hops[i];
    }
    return hops[0] ?? ip;
};
