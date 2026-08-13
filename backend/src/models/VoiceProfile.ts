import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';

interface VoiceProfileAttributes {
  id: string;
  name: string;
  gender: 'male' | 'female';
  emotion: string;
  apiVoiceId: string;
  previewUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type VoiceProfileCreationAttributes = Optional<
  VoiceProfileAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'previewUrl'
>;

export class VoiceProfile
  extends Model<VoiceProfileAttributes, VoiceProfileCreationAttributes>
  implements VoiceProfileAttributes
{
  public id!: string;
  public name!: string;
  public gender!: 'male' | 'female';
  public emotion!: string;
  public apiVoiceId!: string;
  public previewUrl!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

VoiceProfile.init(
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
    gender: {
      type: DataTypes.ENUM('male', 'female'),
      allowNull: false,
    },
    emotion: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'warm',
    },
    apiVoiceId: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    previewUrl: {
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
    tableName: 'voice_profiles',
    timestamps: true,
  },
);

export default VoiceProfile;
