import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(root, 'tests/postman');
const childEnv = { ...process.env };

if (process.env.NEWMAN_ENV_FILE) {
  const { JWT_SECRET } = parseEnv(readFileSync(resolve(root, process.env.NEWMAN_ENV_FILE), 'utf8'));
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not set in NEWMAN_ENV_FILE');
  childEnv.JWT_SECRET = JWT_SECRET;
}

const token = execFileSync('pnpm', ['--filter', '@nook/api', '-s', 'postman:token'], {
  cwd: root,
  env: childEnv,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
}).trim();

mkdirSync(join(dir, 'results'), { recursive: true });

const result = spawnSync(
  'pnpm',
  [
    'exec',
    'newman',
    'run',
    join(dir, 'nook.postman_collection.json'),
    '-e',
    join(dir, 'local.postman_environment.json'),
    '--env-var',
    `token=${token}`,
    ...(process.env.NEWMAN_BASE_URL ? ['--env-var', `baseUrl=${process.env.NEWMAN_BASE_URL}`] : []),
    '--reporters',
    'cli,junit',
    '--reporter-junit-export',
    join(dir, 'results/newman.xml'),
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' },
);
process.exit(result.status ?? 1);
