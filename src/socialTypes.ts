import type { AuthUser, WorkoutLog } from './types.js';

// Legacy IDs remain readable in historical publications; the current collection
// is the six definitions in badgeCatalog.ts.
export type BadgeId = 'first-workout' | 'workouts-10' | 'workouts-25' | 'workouts-50' | 'streak-2' | 'streak-4' | 'streak-8' | 'personal-best';
export type SocialBadge = { id: BadgeId; title: string; description: string; earned: boolean; progress: number; target: number };
export type SocialStats = { completedWorkouts: number; currentWeeklyStreak: number; bestWeeklyStreak: number; personalBests: number; badges: SocialBadge[] };
export type SocialPerson = AuthUser & { sharing: boolean; stats: SocialStats | null };
export type FriendInvitation = { id: string; from: AuthUser; toEmail: string; createdAt: string; direction: 'incoming' | 'outgoing' };
export type SocialGoal = { id: string; owner: AuthUser; title: string; target: number; startDate: string; endDate: string; shared: boolean; progress: number };
export type SocialPost = { id: string; owner: AuthUser; kind: 'workout' | 'badge'; badgeId?: BadgeId; title: string; detail: string; description: string; hasWorkoutDetails: boolean; createdAt: string; cheers: number; cheered: boolean };
export type SocialWorkoutDetail = { userEmail: string; post: SocialPost; workout: WorkoutLog };
export type SocialDashboard = { userEmail: string; me: SocialPerson; invitations: FriendInvitation[]; friends: SocialPerson[]; goals: SocialGoal[]; posts: SocialPost[] };
export type SocialAction =
  | { type: 'invite'; email: string }
  | { type: 'accept' | 'decline' | 'cancel'; invitationId: string }
  | { type: 'removeFriend'; email: string }
  | { type: 'setSharing'; sharing: boolean }
  | { type: 'createGoal'; title: string; target: number; startDate: string; endDate: string; shared: boolean }
  | { type: 'deleteGoal'; goalId: string }
  | { type: 'shareWorkout'; workoutId: string; description?: string }
  | { type: 'shareBadge'; badgeId: BadgeId; description?: string }
  | { type: 'deletePost' | 'cheer'; postId: string };
