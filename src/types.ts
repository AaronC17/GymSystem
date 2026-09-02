export type Unit = 'kg' | 'lb';

export type Exercise = {
  id: string;
  name: string;
  sets: number;
  reps: string;
  rest: number;
  note?: string;
  muscle?: string;
  link?: string;
};

export type RoutineDay = {
  id: string;
  dayOfWeek: number;
  title: string;
  focus: string;
  color: string;
  duration: number;
  exercises: Exercise[];
};

export type Routine = {
  id: string;
  name: string;
  sourceName?: string;
  importedAt?: string;
  days: RoutineDay[];
};

export type SetLog = {
  weight: number;
  reps: number;
  done: boolean;
  unit: Unit;
};

export type ExerciseLog = {
  exerciseId: string;
  exerciseName: string;
  sets: SetLog[];
};

export type WorkoutLog = {
  id: string;
  date: string;
  routineDayId: string;
  title: string;
  duration: number;
  exercises: ExerciseLog[];
  completed: boolean;
};

export type AppState = {
  routine: Routine;
  logs: WorkoutLog[];
  unit: Unit;
};

export type ParsedRoutine = {
  name: string;
  days: Array<{
    dayOfWeek: number;
    title: string;
    exercises: Array<Pick<Exercise, 'name' | 'sets' | 'reps' | 'rest' | 'muscle' | 'link'>>;
  }>;
};
