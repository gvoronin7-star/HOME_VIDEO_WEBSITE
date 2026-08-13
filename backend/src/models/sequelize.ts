import { Sequelize } from 'sequelize';
import { config } from '../config';
import { logger } from '../utils/logger';

const dbConfig = config.database;

const sequelize = new Sequelize({
  dialect: dbConfig.dialect,
  ...(dbConfig.dialect === 'sqlite'
    ? {
        storage: dbConfig.storage,
      }
    : {
        database: dbConfig.name,
        username: dbConfig.user,
        password: dbConfig.password,
        host: dbConfig.host,
        port: dbConfig.port,
      }),
  logging: (msg) => logger.debug(msg),
  ...(dbConfig.dialect === 'postgres'
    ? {
        dialectOptions: {
          ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
        },
        pool: {
          max: 10,
          min: 2,
          acquire: 30000,
          idle: 10000,
        },
      }
    : {}),
});

export default sequelize;