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

  await queryInterface.addColumn('stories', 'shareToken', {
    type: DataTypes.UUID,
    allowNull: true,
    unique: true,
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }) {
  await queryInterface.removeColumn('stories', 'shareToken');
}
