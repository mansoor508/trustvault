import type { RowDataPacket } from 'mysql2/promise';
import { loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
}

async function main(): Promise<void> {
  const targetEmail = process.argv[2]?.trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes('@')) {
    console.error('Error: Please provide a valid user email address to promote.');
    console.error('Usage: npm run promote:platform-admin <email>');
    process.exit(1);
  }

  const { env } = loadEnv();
  const pool = createPool(env);

  try {
    const [rows] = await pool.execute<UserRow[]>(
      'SELECT id, email, display_name, role FROM users WHERE LOWER(email) = ? LIMIT 1',
      [targetEmail],
    );

    const user = rows[0];
    if (!user) {
      console.error(`Error: User with email "${targetEmail}" was not found in the database.`);
      process.exit(1);
    }

    if (user.role === 'platform_admin') {
      console.log(`User "${targetEmail}" (${user.display_name ?? 'No name'}, ID: ${user.id}) is already a Platform Administrator.`);
      process.exit(0);
    }

    console.log(`Promoting "${targetEmail}" from role "${user.role}" to "platform_admin"...`);

    await pool.execute(
      'UPDATE users SET role = ?, updated_at = NOW(3) WHERE id = ?',
      ['platform_admin', user.id],
    );

    // Revoke all existing sessions so subsequent requests require re-authenticating with the new role
    const [sessionResult] = await pool.execute(
      'UPDATE sessions SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
      [user.id],
    );

    const revokedSessions = (sessionResult as { affectedRows?: number }).affectedRows ?? 0;

    console.log(`Success! User "${targetEmail}" is now a Platform Administrator.`);
    console.log(`Revoked ${revokedSessions} active session(s) to enforce security privileges.`);
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error('Fatal error during promotion:', err);
  process.exit(1);
});
