#!/usr/bin/env node
// Crée (ou réinitialise) le compte administrateur.
// Usage : node scripts/create-admin.mjs --email admin@exemple.tn --name "Propriétaire" --password "MotDePasse123" [--remote]
// Le mot de passe est haché localement (PBKDF2-SHA256, 100 000 itérations) : il n'est jamais envoyé en clair à la base.
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const email = String(args.email ?? '').trim().toLowerCase();
const name = String(args.name ?? 'Administrateur');
const password = String(args.password ?? '');
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error('--email requis');
if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw new Error('--password : 8 caractères minimum, lettres et chiffres');

const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, 100000, 32, 'sha256');
const stored = `pbkdf2$100000$${salt.toString('base64')}$${hash.toString('base64')}`;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO users (id, email, full_name, password_hash, role_id, must_change_password) VALUES (${q(randomUUID())}, ${q(email)}, ${q(name)}, ${q(stored)}, 'role-admin', ${args['keep-password'] ? 0 : 1})
ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, role_id = 'role-admin', is_active = 1, full_name = excluded.full_name;
INSERT INTO audit_logs (user_name, action, entity, entity_id, reason) VALUES ('script', 'admin_bootstrap', 'users', ${q(email)}, 'create-admin.mjs');`;

const dir = mkdtempSync(join(tmpdir(), 'ndc-'));
const file = join(dir, 'admin.sql');
writeFileSync(file, sql);
try {
  execSync(`npx wrangler d1 execute nour-de-commerce-db ${args.remote ? '--remote' : '--local'} --file "${file}"`, { stdio: 'inherit' });
  console.log(`\n✅ Administrateur prêt : ${email}${args.remote ? ' (production)' : ' (local)'}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
