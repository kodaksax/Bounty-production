import { connect } from "../lib/db.js";

export async function fetchUsers() {
  try {
    const connection = await connect();
    const [rows] = await connection.execute('SELECT * FROM users');
    await connection.end();
    return rows;
  } catch (error) {
    console.error('Error fetching users:', error);
    throw error;
  }
}

// Note: removed automatic invocation to avoid startup side-effects.