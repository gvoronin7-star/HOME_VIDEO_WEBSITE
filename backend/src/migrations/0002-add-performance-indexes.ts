import { QueryInterface } from 'sequelize';

/**
 * Adds indexes on the foreign keys and filter columns the hot paths actually
 * query by: `stories.userId` (MyStoriesPage lists everything the current user
 * owns), `stories.status`, `story_slides.storyId` and `tasks.storyId` (every
 * slide/task lookup for a story). Postgres does not index foreign keys
 * automatically, so without these each of those was a full table scan.
 *
 * `sequelize.sync()` already creates these indexes on a brand-new database
 * because they are part of the current model definitions; this migration is
 * what brings an already-existing database up to date, since `sync()` never
 * alters an existing table. Each `addIndex` is guarded by name so re-running
 * against a database where `sync()` already created them (or a previous
 * partial run of this migration) is a no-op instead of an error.
 */

const INDEXES: Array<{ table: string; name: string; fields: string[] }> = [
  { table: 'stories', name: 'stories_user_id_idx', fields: ['userId'] },
  { table: 'stories', name: 'stories_status_idx', fields: ['status'] },
  { table: 'story_slides', name: 'story_slides_story_id_idx', fields: ['storyId'] },
  { table: 'tasks', name: 'tasks_story_id_idx', fields: ['storyId'] },
];

export async function up({ context: queryInterface }: { context: QueryInterface }) {
  for (const { table, name, fields } of INDEXES) {
    const existing = await queryInterface.showIndex(table);
    const alreadyExists = (existing as Array<{ name: string }>).some((idx) => idx.name === name);
    if (alreadyExists) continue;

    await queryInterface.addIndex(table, fields, { name });
  }
}

export async function down({ context: queryInterface }: { context: QueryInterface }) {
  for (const { table, name } of INDEXES) {
    await queryInterface.removeIndex(table, name);
  }
}
