// เพิ่มเลขเวอร์ชันอัตโนมัติทุกครั้งที่ commit (เรียกจาก .githooks/pre-commit)
//
// กติกา
//   - ปกติเพิ่มเลขท้าย (patch): 1.0.50 -> 1.0.51
//   - ถ้าแก้เวอร์ชันเองไว้แล้วในรอบนี้ (เช่นตั้งเป็น 1.1.0) จะไม่แตะซ้ำ
//   - ข้ามระหว่าง merge / rebase และข้ามได้ด้วย SKIP_BUMP=1 git commit ...
//   - git commit --amend ก็นับเป็น commit ใหม่ เลขจะขยับอีกครั้ง
//     ถ้าไม่อยากให้ขยับตอนแก้ข้อความ ใช้ SKIP_BUMP=1 git commit --amend
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PKG = 'package.json';

const git = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const skip = (why) => { console.log(`[bump] ข้าม — ${why}`); process.exit(0); };

if (process.env.SKIP_BUMP === '1') skip('ตั้ง SKIP_BUMP=1 ไว้');

const gitDir = (() => { try { return git('rev-parse', '--git-dir'); } catch { return null; } })();
if (!gitDir) skip('ไม่ได้อยู่ใน git repo');
// ระหว่าง merge/rebase/cherry-pick ไม่ควรไปแก้ไฟล์เพิ่ม เดี๋ยว conflict ซ้อน
for (const f of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']) {
    if (existsSync(`${gitDir}/${f}`)) skip(`กำลัง ${f}`);
}

if (!existsSync(PKG)) skip('ไม่มี package.json');

const raw = readFileSync(PKG, 'utf8');
const pkg = JSON.parse(raw);
const current = String(pkg.version ?? '');

// เวอร์ชันของ commit ก่อนหน้า — ใช้เทียบว่าผู้ใช้แก้เองมาแล้วหรือยัง
let previous = null;
try { previous = JSON.parse(git('show', 'HEAD:package.json')).version ?? null; }
catch { skip('ยังไม่มี commit ก่อนหน้า (commit แรก)'); }

if (current !== previous) skip(`แก้เวอร์ชันไว้เองแล้ว (${previous} -> ${current})`);

const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(current);
if (!m) skip(`อ่านเวอร์ชัน "${current}" ไม่ออก`);

const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`;

// แทนที่เฉพาะบรรทัด version บรรทัดแรก เพื่อไม่ให้ JSON.stringify จัดรูปไฟล์ใหม่ทั้งไฟล์
const updated = raw.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${next}"`);
if (updated === raw) skip('หาบรรทัด version ในไฟล์ไม่เจอ');

writeFileSync(PKG, updated);
execFileSync('git', ['add', PKG], { stdio: 'ignore' });
console.log(`[bump] ${current} -> ${next}`);
