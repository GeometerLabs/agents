package store

// The shop's one SQLite file, schema 5. These are the TypeScript runtime's migrations (modules/runtime/store.ts MIGRATIONS) word for word and in the same order: the file a Go
// runtime makes has the same tables, columns, triggers and `PRAGMA user_version` as one the TypeScript runtime makes, so the deployer's backup, snapshot, export and "leave with
// your shop" read it unchanged. Never edit one that has shipped; a new schema is a new entry at the end, in both runtimes.
var migrations = []string{
	`
  CREATE TABLE tasks (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'done', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  );
  CREATE INDEX tasks_by_state ON tasks (state, seq);
  CREATE TABLE state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    snapshot TEXT NOT NULL,
    saved_at INTEGER NOT NULL
  );
  CREATE TABLE record (
    seq INTEGER PRIMARY KEY,
    time TEXT NOT NULL,
    conversation TEXT NOT NULL,
    booking TEXT,
    action TEXT NOT NULL,
    outcome TEXT NOT NULL,
    entry TEXT NOT NULL
  );
  CREATE INDEX record_by_booking ON record (booking);
  CREATE TRIGGER record_no_update BEFORE UPDATE ON record BEGIN SELECT RAISE(ABORT, 'the record is append-only'); END;
  CREATE TRIGGER record_no_delete BEFORE DELETE ON record BEGIN SELECT RAISE(ABORT, 'the record is append-only'); END;
  CREATE TABLE window (
    phone TEXT PRIMARY KEY,
    last_inbound_at INTEGER NOT NULL
  );
  `,
	`
  ALTER TABLE tasks ADD COLUMN waiting_on TEXT;
  ALTER TABLE tasks ADD COLUMN retry_at INTEGER;
  `,
	// Layout 3: the snapshot in pieces. In TypeScript this entry is a function that also moves an old one-row `state` into the pieces; a Go runtime opens files of this age
	// only through the same steps (see migrate in store.go), so the SQL here is the part that makes the tables.
	`
      CREATE TABLE state_shape (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        shape TEXT NOT NULL,
        lists TEXT NOT NULL,
        version INTEGER NOT NULL,
        saved_at INTEGER NOT NULL
      );
      CREATE TABLE state_rows (
        list TEXT NOT NULL,
        pos INTEGER NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (list, pos)
      ) WITHOUT ROWID;
    `,
	`
  CREATE TABLE listing_photos (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('image/jpeg', 'image/webp')),
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    bytes BLOB NOT NULL,
    at_ms INTEGER NOT NULL
  ) WITHOUT ROWID;
  `,
	`
  CREATE TABLE shop_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    private_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
}

// SchemaVersion is the number of migrations: what `PRAGMA user_version` says when the file is up to date.
var SchemaVersion = len(migrations)
