import { Umzug, SequelizeStorage } from 'umzug';
import sequelize from '../models/sequelize';
import * as m0001 from './0001-add-story-share-token';
import * as m0002 from './0002-add-performance-indexes';
import * as m0003 from './0003-add-story-voice-profile-id';

/**
 * Versioned migrations, for changes `sequelize.sync()` cannot make safely
 * (altering or backfilling a column on an existing table). New tables are
 * still created by `sync()` in `utils/migrate.ts` — that part needs no
 * migration, since there is nothing existing to preserve.
 *
 * Migrations are listed explicitly rather than discovered by globbing a
 * directory, so the same list runs unchanged whether this executes under
 * ts-node (`src/migrations/*.ts`) or from the compiled `dist/` output — no
 * glob pattern has to be kept in sync with the build output extension.
 */
export const umzug = new Umzug({
  migrations: [
    { name: '0001-add-story-share-token', up: m0001.up, down: m0001.down },
    { name: '0002-add-performance-indexes', up: m0002.up, down: m0002.down },
    { name: '0003-add-story-voice-profile-id', up: m0003.up, down: m0003.down },
  ],
  context: sequelize.getQueryInterface(),
  storage: new SequelizeStorage({ sequelize }),
  logger: console,
});
