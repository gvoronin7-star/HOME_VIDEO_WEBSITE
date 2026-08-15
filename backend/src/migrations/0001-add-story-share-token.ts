import { DataTypes, QueryInterface } from 'sequelize';

/**
 * Adds `stories.shareToken`, the opaque id public share links and QR codes are
 * built from instead of the story's own primary key — see the comment on the
 * Story model. `sequelize.sync()` already creates this column on a brand-new
 * database because it is part of the current model definition; this migration
 * is what brings an already-existing database (any database that predates this
 * column) up to date, since `sync()` never alters existing tables.
 */
export async function up({ context: queryInterface }: { context: QueryInterface }) {
  const table = await queryInterface.describeTable('stories');
  if (table.shareToken) return;

  // Adding the UNIQUE constraint inline on ADD COLUMN works on Postgres but SQLite's
  // ALTER TABLE ADD COLUMN rejects a column-level UNIQUE outright ("Cannot add a UNIQUE
  // column"). A separate unique index is valid SQL on both dialects.
  await queryInterface.addColumn('stories', 'shareToken', {
    type: DataTypes.UUID,
    allowNull: true,
  });
  await queryInterface.addIndex('stories', ['shareToken'], {
    unique: true,
    name: 'stories_share_token_unique',
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }) {
  await queryInterface.removeIndex('stories', 'stories_share_token_unique');
  await queryInterface.removeColumn('stories', 'shareToken');
}
