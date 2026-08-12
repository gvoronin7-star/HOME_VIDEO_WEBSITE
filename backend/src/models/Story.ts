import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';
import { User } from './User';
import { Template } from './Template';

type StoryStatus = 'draft' | 'script_generating' | 'script_ready' | 'rendering' | 'ready' | 'error';

interface StoryAttributes {
  id: string;
  userId: string;
  title: string;
  templateId: string;
  status: StoryStatus;
  tone: string;
  voiceGender: 'male' | 'female';
  scriptText: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  qrCodeUrl: string | null;
  publicUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoryCreationAttributes extends Optional<StoryAttributes, 'id' | 'createdAt' | 'updatedAt' | 'scriptText' | 'videoUrl' | 'pdfUrl' | 'qrCodeUrl' | 'publicUrl'> {}

export class Story extends Model<StoryAttributes, StoryCreationAttributes> implements StoryAttributes {
  public id!: string;
  public userId!: string;
  public title!: string;
  public templateId!: string;
  public status!: StoryStatus;
  public tone!: string;
  public voiceGender!: 'male' | 'female';
  public scriptText!: string | null;
  public videoUrl!: string | null;
  public pdfUrl!: string | null;
  public qrCodeUrl!: string | null;
  public publicUrl!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Associations (populated via include)
  public readonly slides?: any[];
  public readonly template?: Template;
  public readonly tasks?: Array<{
    id: string;
    storyId: string;
    type: string;
    status: string;
    errorMessage: string | null;
    progress: number;
    resultData: object | null;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}

Story.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'id',
      },
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: 'Моя история',
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Template,
        key: 'id',
      },
    },
    status: {
      type: DataTypes.ENUM('draft', 'script_generating', 'script_ready', 'rendering', 'ready', 'error'),
      defaultValue: 'draft',
    },
    tone: {
      type: DataTypes.STRING(100),
      defaultValue: 'warm',
    },
    voiceGender: {
      type: DataTypes.ENUM('male', 'female'),
      defaultValue: 'female',
    },
    scriptText: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    videoUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    pdfUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    qrCodeUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    publicUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
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
    tableName: 'stories',
    timestamps: true,
  }
);

export default Story;