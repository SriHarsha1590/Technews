// Runs once when Mongo initializes an empty data volume.
db = db.getSiblingDB('technews');
db.createUser({
  user: process.env.MONGO_APP_USER,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'technews' }],
});

db = db.getSiblingDB('admin');
db.createUser({
  user: process.env.MONGO_BACKUP_USER,
  pwd: process.env.MONGO_BACKUP_PASSWORD,
  roles: [{ role: 'backup', db: 'admin' }, { role: 'restore', db: 'admin' }],
});
