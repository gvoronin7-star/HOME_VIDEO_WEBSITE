import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';
import { User } from './User';
import { Template } from './Template';
import { VoiceProfile } from './VoiceProfile';

type StoryStatus = 'draft' | 'script_generating' | 'script_ready' | 'rendering' | 'ready' | 'error';

interface StoryAttributes {
  id: string;
  userId: string;
  title: string;
  templateId: string;
  status: StoryStatus;
  tone: string;
  voiceGender: 'male' | 'female';
  // Specific named voice, chosen from the seeded catalogue — when set, its
  // apiVoiceId overrides the gender/tone-derived VOICE_MAP fallback in
  // tts.service.ts. Nullable: stories created before this existed, or without
  // picking a specific voice, fall back to that mapping as before.
  voiceProfileId: string | null;
  scriptText: string | null;
  videoUrl: string | null;
  pdfUrl: string | null;
  qrCodeUrl: string | null;
  publicUrl: string | null;
  // Opaque id the public share page and QR code are built from — deliberately
  // not the story's own primary key, so a revoked/rotated link cannot be
  // recovered by anyone who still has the old one, and rotating it never
  // touches the story's id or any foreign key that points at it.
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type StoryCreationAttributes = Optional<
  StoryAttributes,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'scriptText'
  | 'videoUrl'
  | 'pdfUrl'
  | 'qrCodeUrl'
  | 'publicUrl'
  | 'shareToken'
  | 'voiceProfileId'
>;

export class Story
  extends Model<StoryAttributes, StoryCreationAttributes>
  implements StoryAttributes
{
  public id!: string;
  public userId!: string;
  public title!: string;
  public templateId!: string;
  public status!: StoryStatus;
  public tone!: string;
  public voiceGender!: 'male' | 'female';
  public voiceProfileId!: string | null;
  public scriptText!: string | null;
  public videoUrl!: string | null;
  public pdfUrl!: string | null;
  public qrCodeUrl!: string | null;
  public publicUrl!: string | null;
  public shareToken!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Associations (populated via include)
  public readonly slides?: any[];
  public readonly template?: Template;
  public readonly voiceProfile?: VoiceProfile;
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
      type: DataTypes.ENUM(
        'draft',
        'script_generating',
        'script_ready',
        'rendering',
        'ready',
        'error',
      ),
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
    voiceProfileId: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: VoiceProfile,
        key: 'id',
      },
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
    shareToken: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: true,
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
    indexes: [
      // MyStoriesPage lists every story owned by the current user — without this,
      // that query is a full table scan. Postgres does not index foreign keys
      // automatically.
      { name: 'stories_user_id_idx', fields: ['userId'] },
      { name: 'stories_status_idx', fields: ['status'] },
    ],
  },
);

export default Story;
