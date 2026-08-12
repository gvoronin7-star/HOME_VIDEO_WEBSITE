import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from './sequelize';
import { Story } from './Story';

type TaskType = 'generate_script' | 'generate_tts' | 'render_video' | 'generate_pdf' | 'generate_qr';
type TaskStatus = 'pending' | 'queued' | 'processing' | 'completed' | 'failed';

interface TaskAttributes {
  id: string;
  storyId: string;
  type: TaskType;
  status: TaskStatus;
  errorMessage: string | null;
  progress: number;
  resultData: object | null;
  createdAt: Date;
  completedAt: Date | null;
}

interface TaskCreationAttributes extends Optional<TaskAttributes, 'id' | 'createdAt' | 'completedAt' | 'errorMessage' | 'progress' | 'resultData'> {}

export class Task extends Model<TaskAttributes, TaskCreationAttributes> implements TaskAttributes {
  public id!: string;
  public storyId!: string;
  public type!: TaskType;
  public status!: TaskStatus;
  public errorMessage!: string | null;
  public progress!: number;
  public resultData!: object | null;
  public createdAt!: Date;
  public completedAt!: Date | null;
}

Task.init(
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
    type: {
      type: DataTypes.ENUM('generate_script', 'generate_tts', 'render_video', 'generate_pdf', 'generate_qr'),
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('pending', 'queued', 'processing', 'completed', 'failed'),
      defaultValue: 'pending',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    resultData: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'tasks',
    timestamps: false,
  }
);

export default Task;