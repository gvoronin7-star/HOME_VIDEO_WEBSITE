import { User } from './User';
import { Story } from './Story';
import { StorySlide } from './StorySlide';
import { Template } from './Template';
import { VoiceProfile } from './VoiceProfile';
import { Task } from './Task';

// User associations
User.hasMany(Story, { foreignKey: 'userId', as: 'stories' });
Story.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// Story associations
Story.hasMany(StorySlide, { foreignKey: 'storyId', as: 'slides', onDelete: 'CASCADE' });
StorySlide.belongsTo(Story, { foreignKey: 'storyId', as: 'story' });

Story.belongsTo(Template, { foreignKey: 'templateId', as: 'template' });
Template.hasMany(Story, { foreignKey: 'templateId', as: 'stories' });

// Task associations
Story.hasMany(Task, { foreignKey: 'storyId', as: 'tasks', onDelete: 'CASCADE' });
Task.belongsTo(Story, { foreignKey: 'storyId', as: 'story' });

export { User, Story, StorySlide, Template, VoiceProfile, Task };
