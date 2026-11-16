import fs from 'node:fs'; import path from 'node:path'; import { seed } from './seed';
export default async function () { const s = await seed(); fs.mkdirSync(path.join(__dirname, '.run'), { recursive: true }); fs.writeFileSync(path.join(__dirname, '.run', 'seed.json'), JSON.stringify(s)); }
