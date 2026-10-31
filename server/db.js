import { DatabaseSync } from 'node:sqlite';

/** Kleine opslaglaag: één JSON-document per kledingstuk in SQLite. */
export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS items (
      id      TEXT PRIMARY KEY,
      data    TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
  `);
  const qList = db.prepare('SELECT data FROM items ORDER BY updated DESC');
  const qGet = db.prepare('SELECT data FROM items WHERE id = ?');
  const qPut = db.prepare('INSERT INTO items (id, data, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated = excluded.updated');
  const qDel = db.prepare('DELETE FROM items WHERE id = ?');
  return {
    list: () => qList.all().map(r => JSON.parse(r.data)),
    get: (id) => { const r = qGet.get(id); return r ? JSON.parse(r.data) : null; },
    put: (item) => { qPut.run(item.id, JSON.stringify(item), item.updated); },
    del: (id) => qDel.run(id).changes > 0,
    close: () => db.close()
  };
}
