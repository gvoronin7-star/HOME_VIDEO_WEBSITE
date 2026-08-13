import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';

interface TemplateAttributes {
  id: string;
  name: string;
  description: string;
  tone: string;
  defaultDurationSeconds: number;
  promptTemplate: string;
  createdAt: Date;
  updatedAt: Date;
}

type TemplateCreationAttributes = Optional<TemplateAttributes, 'id' | 'createdAt' | 'updatedAt'>;

export class Template
  extends Model<TemplateAttributes, TemplateCreationAttributes>
  implements TemplateAttributes
{
  public id!: string;
  public name!: string;
  public description!: string;
  public tone!: string;
  public defaultDurationSeconds!: number;
  public promptTemplate!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Template.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tone: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    defaultDurationSeconds: {
      type: DataTypes.INTEGER,
      defaultValue: 4,
    },
    promptTemplate: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'templates',
    timestamps: true,
  },
);

export default Template;
