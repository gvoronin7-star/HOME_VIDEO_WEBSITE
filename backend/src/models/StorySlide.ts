import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';
import { Story } from './Story';

interface StorySlideAttributes {
  id: string;
  storyId: string;
  imageUrl: string;
  imageKey: string;
  orderIndex: number;
  caption: string;
  durationSeconds: number;
  isKeyFrame: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type StorySlideCreationAttributes = Optional<
  StorySlideAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'caption' | 'durationSeconds' | 'isKeyFrame'
>;

export class StorySlide
  extends Model<StorySlideAttributes, StorySlideCreationAttributes>
  implements StorySlideAttributes
{
  public id!: string;
  public storyId!: string;
  public imageUrl!: string;
  public imageKey!: string;
  public orderIndex!: number;
  public caption!: string;
  public durationSeconds!: number;
  public isKeyFrame!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StorySlide.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    storyId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Story,
        key: 'id',
      },
    },
    imageUrl: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    imageKey: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    orderIndex: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    caption: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: '',
    },
    durationSeconds: {
      type: DataTypes.INTEGER,
      defaultValue: 4,
    },
    isKeyFrame: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
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
    tableName: 'story_slides',
    timestamps: true,
    indexes: [
      // Every slide list is loaded by storyId (via the Story include); Postgres
      // does not index foreign keys automatically.
      { name: 'story_slides_story_id_idx', fields: ['storyId'] },
    ],
  },
);

export default StorySlide;
