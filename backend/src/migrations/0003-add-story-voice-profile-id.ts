import { DataTypes, QueryInterface } from 'sequelize';

/**
 * Adds `stories.voiceProfileId`, letting a story pin a specific seeded voice
 * (its `apiVoiceId` overrides the gender/tone-derived VOICE_MAP fallback in
 * tts.service.ts) instead of only ever picking a voice from gender + tone.
 * `sequelize.sync()` already creates this column on a brand-new database
 * because it is part of the current model definition; this migration is what
 * brings an already-existing database up to date, since `sync()` never
 * alters an existing table.
 */
export async function up({ context: queryInterface }: { context: QueryInterface }) {
  const table = await queryInterface.describeTable('stories');
  if (table.voiceProfileId) return;

  await queryInterface.addColumn('stories', 'voiceProfileId', {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'voice_profiles',
      key: 'id',
    },
  });
}

export async function down({ context: queryInterface }: { context: QueryInterface }) {
  await queryInterface.removeColumn('stories', 'voiceProfileId');
}
