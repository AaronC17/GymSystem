import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  FileText,
  Flame,
  Home,
  Eye,
  EyeOff,
  ExternalLink,
  LineChart,
  ListChecks,
  LockKeyhole,
  LogOut,
  Mail,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ACCENT_COLORS,
  addDays,
  cloneRoutine,
  convertWeight,
  createInitialState,
  DAY_NAMES,
  DAY_NAMES_SHORT,
  displayWeight,
  exerciseCount,
  fromDateKey,
  getLastExerciseSets,
  loadState,
  localDateKey,
  routineFromParsed,
  saveState,
  startOfWeek,
  uid,
} from './data';
import type {
  AppState,
  Exercise,
  ExerciseLog,
  Routine,
  RoutineDay,
  SetLog,
  Unit,
  WorkoutLog,
} from './types';

type Page = 'inicio' | 'rutina' | 'calendario' | 'progreso';

type ActiveWorkout = {
  day: RoutineDay;
  date: string;
};

type AuthUser = {
  name: string;
  email: string;
};

type StoredWorkoutDraft = {
  routineDayId: string;
  date: string;
  seconds: number;
  exerciseLogs: ExerciseLog[];
  savedAt: string;
};

const ACTIVE_WORKOUT_KEY = 'tempo-active-workout-v1';
const AUTH_STORAGE_KEY = 'tempo-auth-user-v1';
const LOGIN_EMAIL = 'kyani1278@gmail.com';
const LOGIN_PASSWORD = 'blackelcita666';

function readAuthUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY) ?? localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as Partial<AuthUser>;
    return typeof user.name === 'string' && typeof user.email === 'string' ? user as AuthUser : null;
  } catch {
    return null;
  }
}

function storeAuthUser(user: AuthUser, remember: boolean) {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Authentication remains valid for this render if storage is blocked.
  }
}

function clearAuthUser() {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // The in-memory session is still cleared below.
  }
}

function readWorkoutDraft(): StoredWorkoutDraft | null {
  try {
    const raw = localStorage.getItem(ACTIVE_WORKOUT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<StoredWorkoutDraft>;
    if (
      typeof draft.routineDayId === 'string' &&
      typeof draft.date === 'string' &&
      typeof draft.seconds === 'number' &&
      Number.isFinite(draft.seconds) &&
      Array.isArray(draft.exerciseLogs) &&
      draft.exerciseLogs.every((exercise) =>
        typeof exercise.exerciseId === 'string' &&
        typeof exercise.exerciseName === 'string' &&
        Array.isArray(exercise.sets) &&
        exercise.sets.every((set) =>
          typeof set.weight === 'number' && Number.isFinite(set.weight) &&
          typeof set.reps === 'number' && Number.isFinite(set.reps) &&
          typeof set.done === 'boolean' &&
          (set.unit === 'kg' || set.unit === 'lb'),
        ),
      )
    ) {
      return draft as StoredWorkoutDraft;
    }
  } catch {
    return null;
  }
  return null;
}

function clearWorkoutDraft() {
  try {
    localStorage.removeItem(ACTIVE_WORKOUT_KEY);
  } catch {
    // Nothing else is required when private storage is unavailable.
  }
}

const esDate = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const esMonth = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
});

const esShortDate = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
});

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('es-ES', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value);
}

function parseTargetReps(reps: string) {
  return Number(reps.match(/\d+/)?.[0] ?? 10);
}

function getRoutineForDate(routine: Routine, date: Date) {
  return routine.days.find((day) => day.dayOfWeek === date.getDay());
}

function findLogForDate(logs: WorkoutLog[], date: Date, routineDayId?: string) {
  const key = localDateKey(date);
  return logs.find(
    (log) => log.date === key && (!routineDayId || log.routineDayId === routineDayId),
  );
}

function getNextWorkout(routine: Routine, logs: WorkoutLog[], from = new Date()) {
  if (routine.days.length === 0) return null;
  for (let offset = 0; offset <= 14; offset += 1) {
    const date = addDays(from, offset);
    const day = getRoutineForDate(routine, date);
    if (!day) continue;
    if (findLogForDate(logs, date, day.id)?.completed) continue;
    return { day, date };
  }
  return { day: routine.days[0], date: from };
}

function getWeekDates(date: Date) {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function getMonthLogs(logs: WorkoutLog[], date: Date) {
  return logs.filter((log) => {
    const logDate = fromDateKey(log.date);
    return logDate.getMonth() === date.getMonth() && logDate.getFullYear() === date.getFullYear();
  });
}

function getStreak(routine: Routine, logs: WorkoutLog[]) {
  let streak = 0;
  const today = new Date();
  for (let offset = 0; offset < 90; offset += 1) {
    const date = addDays(today, -offset);
    const planned = getRoutineForDate(routine, date);
    if (!planned) continue;
    const completed = findLogForDate(logs, date, planned.id)?.completed;
    if (!completed && offset === 0) continue;
    if (!completed) break;
    streak += 1;
  }
  return streak;
}

function getBestStreak(routine: Routine, logs: WorkoutLog[]) {
  let current = 0;
  let best = 0;
  const today = new Date();
  for (let offset = 180; offset >= 0; offset -= 1) {
    const date = addDays(today, -offset);
    const planned = getRoutineForDate(routine, date);
    if (!planned) continue;
    if (findLogForDate(logs, date, planned.id)?.completed) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }
  return best;
}

function getRecentConsistency(routine: Routine, logs: WorkoutLog[], weeks = 4) {
  const currentWeek = startOfWeek(new Date());
  const todayKey = localDateKey(new Date());
  let plannedTotal = 0;
  let completedTotal = 0;
  const values = Array.from({ length: weeks }, (_, index) => {
    const start = addDays(currentWeek, (index - weeks + 1) * 7);
    const dates = Array.from({ length: 7 }, (_, dayIndex) => addDays(start, dayIndex));
    const plannedDates = dates.filter((date) => localDateKey(date) <= todayKey && getRoutineForDate(routine, date));
    const completed = plannedDates.filter((date) => {
      const day = getRoutineForDate(routine, date);
      return day && findLogForDate(logs, date, day.id)?.completed;
    }).length;
    plannedTotal += plannedDates.length;
    completedTotal += completed;
    return plannedDates.length ? Math.round((completed / plannedDates.length) * 100) : 0;
  });
  return {
    values,
    planned: plannedTotal,
    completed: completedTotal,
    score: plannedTotal ? Math.round((completedTotal / plannedTotal) * 100) : 0,
  };
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} aria-label="Trazza+">
      <div className="brand-mark">
        <span>T</span>
        <i />
      </div>
      {!compact && (
        <div className="brand-copy">
          <strong>TRAZZA+</strong>
          <small>TRAINING JOURNAL</small>
        </div>
      )}
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: AuthUser, remember: boolean) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('');
    if (!email.trim() || !password) {
      setError('Ingresa tu correo y contraseña para continuar.');
      return;
    }
    if (email.trim().toLowerCase() !== LOGIN_EMAIL || password !== LOGIN_PASSWORD) {
      setError('Las credenciales no coinciden.');
      return;
    }
    setError('');
    setSubmitting(true);
    window.setTimeout(() => onLogin({ name: 'Kyani', email: LOGIN_EMAIL }, remember), 450);
  }

  return (
    <main className="login-page">
      <section className="login-showcase">
        <div className="login-showcase-top">
          <Logo />
          <span><i /> TU PROGRESO, EN MOVIMIENTO</span>
        </div>
        <div className="login-message">
          <span>ENTRENA · REGISTRA · AVANZA</span>
          <h1>Tu progreso no se adivina.<br /><em>Se registra.</em></h1>
          <p>Convierte cada serie, repetición y kilo en una decisión mejor para tu próximo entrenamiento.</p>
        </div>
        <div className="login-visual" aria-hidden="true">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="visual-card visual-session-card">
            <div><span>LECTURA DEL PDF</span><i><ScanText size={14} /></i></div>
            <strong>Estructura detectada</strong>
            <p>Días y ejercicios listos para revisar</p>
            <b><i /></b>
          </div>
          <div className="visual-card visual-progress-card">
            <span>ORGANIZACIÓN AUTOMÁTICA</span>
            <strong>Por <small>día</small></strong>
            <div><ListChecks size={13} /> Series y repeticiones</div>
          </div>
          <div className="visual-weight"><FileText size={20} /><span><b>PDF</b> organizado</span></div>
        </div>
        <footer><span>© {new Date().getFullYear()} Trazza+ Training Journal</span><span>Privado · Seguro · Personal</span></footer>
      </section>

      <section className="login-access">
        <div className="login-mobile-logo"><Logo /></div>
        <div className="login-form-shell">
          <form onSubmit={submit} noValidate>
            <label className="login-field">
              <span>Correo electrónico</span>
              <div className={error && !email ? 'invalid' : ''}>
                <Mail size={17} />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(''); }}
                  placeholder="nombre@correo.com"
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </label>
            <label className="login-field">
              <span>Contraseña</span>
              <div className={error && !password ? 'invalid' : ''}>
                <LockKeyhole size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError(''); }}
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            <div className="login-options">
              <label><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /><i><Check size={11} /></i><span>Recordarme</span></label>
              <button type="button" onClick={() => setNotice('La recuperación se conectará al correo de tu cuenta.')}>¿Olvidaste tu contraseña?</button>
            </div>

            {error && <p className="login-feedback error"><X size={14} /> {error}</p>}
            {notice && <p className="login-feedback"><Check size={14} /> {notice}</p>}

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? <><i className="login-spinner" /> Verificando...</> : <><span>Iniciar sesión</span><ArrowRight className="login-submit-arrow" size={17} /></>}
            </button>
          </form>

          <p className="login-support">¿Necesitas ayuda? <button type="button" onClick={() => setNotice('Escríbenos a soporte@tempo.fit.')}>Contactar soporte</button></p>
        </div>
        <div className="login-security"><ShieldCheck size={14} /> Tus datos de entrenamiento permanecen privados en este dispositivo.</div>
      </section>
    </main>
  );
}

const navItems: Array<{ id: Page; label: string; icon: typeof Home }> = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'rutina', label: 'Mi rutina', icon: Dumbbell },
  { id: 'calendario', label: 'Calendario', icon: CalendarDays },
  { id: 'progreso', label: 'Progreso', icon: BarChart3 },
];

function Sidebar({
  page,
  user,
  onNavigate,
  onLogout,
}: {
  page: Page;
  user: AuthUser;
  onNavigate: (page: Page) => void;
  onLogout: () => void;
}) {
  const initials = user.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  return (
    <aside className="sidebar">
      <Logo />
      <nav className="main-nav" aria-label="Navegación principal">
        <span className="nav-kicker">MENÚ</span>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              className={`nav-item ${page === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <Icon size={19} strokeWidth={1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-motivation">
        <div className="motivation-icon"><Zap size={17} /></div>
        <strong>Hazlo medible.</strong>
        <p>Lo que registras hoy construye tu progreso de mañana.</p>
      </div>
      <div className="profile-chip">
        <div className="avatar">{initials}</div>
        <div>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <button className="profile-logout" type="button" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión"><LogOut size={16} /></button>
      </div>
    </aside>
  );
}

function Topbar({
  page,
  unit,
  user,
  onToggleUnit,
  onImport,
  onNotify,
  onLogout,
  onStartWorkout,
  workoutActionLabel,
  hasRoutine,
}: {
  page: Page;
  unit: Unit;
  user: AuthUser;
  onToggleUnit: () => void;
  onImport: () => void;
  onNotify: () => void;
  onLogout: () => void;
  onStartWorkout: () => void;
  workoutActionLabel: string;
  hasRoutine: boolean;
}) {
  const firstName = user.name.split(' ')[0] || 'Atleta';
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Buenos días';
    if (hour >= 12 && hour < 19) return 'Buenas tardes';
    return 'Buenas noches';
  })();
  const titles: Record<Page, { eyebrow: string; title: string }> = {
    inicio: { eyebrow: 'TU ESPACIO DE ENTRENAMIENTO', title: `${greeting}, ${firstName}` },
    rutina: { eyebrow: 'PLAN DE ENTRENAMIENTO', title: 'Mi rutina' },
    calendario: { eyebrow: 'HISTORIAL DE ACTIVIDAD', title: 'Calendario' },
    progreso: { eyebrow: 'DATOS Y EVOLUCIÓN', title: 'Tu progreso' },
  };

  return (
    <header className="topbar">
      <div className="mobile-brand"><Logo compact /></div>
      <div className="page-title">
        <span>{titles[page].eyebrow}</span>
        <h1>{titles[page].title}</h1>
      </div>
      <div className="topbar-actions">
        {hasRoutine && (
          <button className="unit-toggle" type="button" onClick={onToggleUnit}>
            <span className={unit === 'kg' ? 'selected' : ''}>KG</span>
            <span className={unit === 'lb' ? 'selected' : ''}>LB</span>
          </button>
        )}
        <button className="icon-button" type="button" aria-label="Notificaciones" onClick={onNotify}>
          <Bell size={19} />
          <i className="notification-dot" />
        </button>
        <button className="icon-button mobile-logout" type="button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={onLogout}>
          <LogOut size={18} />
        </button>
        <button className="button button-accent quick-start-top" type="button" onClick={onStartWorkout}>
          {hasRoutine ? <Play size={16} fill="currentColor" /> : <Upload size={16} />}
          {workoutActionLabel}
        </button>
        {hasRoutine && (
          <button className="button button-dark import-top" type="button" onClick={onImport}>
            <Upload size={17} />
            Importar rutina
          </button>
        )}
      </div>
    </header>
  );
}

function EmptyRoutineState({ page, onImport }: { page: Page; onImport: () => void }) {
  const context: Record<Page, { eyebrow: string; title: string; description: string }> = {
    inicio: {
      eyebrow: 'EMPIEZA POR TU PLAN',
      title: 'Tu espacio está listo. Falta tu rutina.',
      description: 'Sube el PDF que te entregó tu entrenador. Trazza+ leerá su estructura y organizará cada ejercicio en el día correspondiente.',
    },
    rutina: {
      eyebrow: 'SIN RUTINA ACTIVA',
      title: 'Importa tu primera rutina.',
      description: 'Detectaremos días, nombres de ejercicios, series y repeticiones antes de incorporarlos al sistema.',
    },
    calendario: {
      eyebrow: 'CALENDARIO VACÍO',
      title: 'Primero necesitamos tu rutina.',
      description: 'Cuando confirmes el PDF, sus días aparecerán automáticamente en tu calendario de entrenamiento.',
    },
    progreso: {
      eyebrow: 'AÚN NO HAY REGISTROS',
      title: 'El progreso comienza con tu plan.',
      description: 'No mostraremos estadísticas hasta importar una rutina y completar tus propios entrenamientos.',
    },
  };
  const copy = context[page];

  return (
    <div className="page-content empty-routine-page">
      <section className="empty-routine-hero">
        <div className="empty-hero-copy">
          <span>{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
          <button className="button button-accent empty-upload-button" type="button" onClick={onImport}>
            <Upload size={18} /> Subir rutina en PDF <ArrowRight size={17} />
          </button>
          <small><ShieldCheck size={13} /> El archivo se procesa localmente y podrás revisar todo antes de guardarlo.</small>
        </div>
        <div className="empty-document-visual" aria-hidden="true">
          <div className="empty-document">
            <div><Logo compact /><span>RUTINA DE ENTRENAMIENTO</span></div>
            <i /><i /><i />
            <section><b>01</b><span /><em>4 × 8–10</em></section>
            <section><b>02</b><span /><em>3 × 10–12</em></section>
            <section><b>03</b><span /><em>3 × 12–15</em></section>
          </div>
          <div className="detection-badge"><ScanText size={18} /><span><strong>Analizando estructura</strong><small>Días · ejercicios · series · reps</small></span><Check size={15} /></div>
        </div>
      </section>

      <section className="import-process">
        <div className="process-heading"><span>CÓMO FUNCIONA</span><h3>Del PDF a tu próximo entreno</h3></div>
        <div className="process-steps">
          <article><b>01</b><span><Upload size={18} /></span><h4>Sube el PDF</h4><p>Selecciona la rutina original sin completar datos manualmente.</p></article>
          <article><b>02</b><span><ScanText size={18} /></span><h4>Trazza+ la organiza</h4><p>Detecta la división semanal y los ejercicios asignados a cada día.</p></article>
          <article><b>03</b><span><ListChecks size={18} /></span><h4>Revisa e importa</h4><p>Confirma series y repeticiones antes de llevar el plan al sistema.</p></article>
        </div>
      </section>
    </div>
  );
}

function WeekStrip({ routine, logs }: { routine: Routine; logs: WorkoutLog[] }) {
  const todayKey = localDateKey(new Date());
  return (
    <div className="week-strip">
      {getWeekDates(new Date()).map((date) => {
        const key = localDateKey(date);
        const routineDay = getRoutineForDate(routine, date);
        const completed = routineDay && findLogForDate(logs, date, routineDay.id)?.completed;
        const isToday = key === todayKey;
        return (
          <div
            className={`week-day ${isToday ? 'today' : ''} ${completed ? 'completed' : ''}`}
            key={key}
          >
            <span>{DAY_NAMES_SHORT[date.getDay()]}</span>
            <strong>{date.getDate()}</strong>
            <i style={routineDay ? { backgroundColor: routineDay.color } : undefined}>
              {completed && <Check size={10} strokeWidth={3} />}
            </i>
          </div>
        );
      })}
    </div>
  );
}

function RingProgress({ value }: { value: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;
  return (
    <div className="ring-progress">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={radius} />
        <circle
          className="ring-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div><strong>{value}%</strong><span>semana</span></div>
    </div>
  );
}

type ChartPoint = { label: string; value: number; detail?: string };

function AreaChart({
  points,
  compact = false,
  emptyTitle = 'Aún no hay registros suficientes',
  emptyText = 'Completa este ejercicio para comenzar a ver su evolución.',
}: {
  points: ChartPoint[];
  compact?: boolean;
  emptyTitle?: string;
  emptyText?: string;
}) {
  if (points.length === 0) {
    return (
      <div className="chart-empty">
        <span><LineChart size={24} /></span>
        <strong>{emptyTitle}</strong>
        <p>{emptyText}</p>
      </div>
    );
  }
  const width = 640;
  const height = compact ? 150 : 220;
  const padX = 20;
  const padY = 24;
  const max = Math.max(...points.map((point) => point.value), 1) * 1.12;
  const min = Math.min(...points.map((point) => point.value), 0) * 0.92;
  const range = max - min || 1;
  const coordinates = points.map((point, index) => ({
    x: padX + (index * (width - padX * 2)) / Math.max(points.length - 1, 1),
    y: padY + ((max - point.value) / range) * (height - padY * 2),
  }));
  const line = coordinates.map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${coordinates.at(-1)?.x ?? padX} ${height - padY} L ${padX} ${height - padY} Z`;

  return (
    <div className={`area-chart ${compact ? 'compact' : ''}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Gráfica de progreso">
        <defs>
          <linearGradient id={`chartFill-${compact ? 'small' : 'large'}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b9dc35" stopOpacity="0.34" />
            <stop offset="1" stopColor="#b9dc35" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.2, 0.5, 0.8].map((position) => (
          <line key={position} x1="0" x2={width} y1={height * position} y2={height * position} className="chart-gridline" />
        ))}
        <path d={area} fill={`url(#chartFill-${compact ? 'small' : 'large'})`} />
        <path d={line} className="chart-line" />
        {coordinates.map((point, index) => (
          <g key={`${points[index].label}-${index}`}>
            <circle cx={point.x} cy={point.y} r={compact ? 3.5 : 4.5} className="chart-dot" />
            <title>{`${points[index].label}: ${points[index].detail ?? formatCompact(points[index].value)}`}</title>
          </g>
        ))}
      </svg>
      <div className="chart-labels">
        {points.map((point) => <span key={point.label}>{point.label}</span>)}
      </div>
    </div>
  );
}

function weeklySessionPoints(logs: WorkoutLog[], weeks = 6): ChartPoint[] {
  if (logs.length === 0) return [];
  const currentWeek = startOfWeek(new Date());
  return Array.from({ length: weeks }, (_, index) => {
    const start = addDays(currentWeek, (index - weeks + 1) * 7);
    const end = addDays(start, 7);
    const value = logs
      .filter((log) => {
        const date = fromDateKey(log.date);
        return date >= start && date < end;
      })
      .filter((log) => log.completed).length;
    return {
      label: index === weeks - 1 ? 'Ahora' : `${start.getDate()} ${start.toLocaleDateString('es-ES', { month: 'short' }).replace('.', '')}`,
      value,
      detail: `${value} ${value === 1 ? 'entrenamiento' : 'entrenamientos'}`,
    };
  });
}

function Dashboard({
  state,
  onStart,
  onNavigate,
  onImport,
}: {
  state: AppState;
  onStart: (day: RoutineDay, date?: Date) => void;
  onNavigate: (page: Page) => void;
  onImport: () => void;
}) {
  const { routine, logs } = state;
  const next = getNextWorkout(routine, logs);
  if (!next) return <EmptyRoutineState page="inicio" onImport={onImport} />;
  const weekDates = getWeekDates(new Date());
  const weekPlanned = weekDates.filter((date) => getRoutineForDate(routine, date)).length;
  const weekCompleted = weekDates.filter((date) => {
    const day = getRoutineForDate(routine, date);
    return day && findLogForDate(logs, date, day.id)?.completed;
  }).length;
  const completion = weekPlanned ? Math.round((weekCompleted / weekPlanned) * 100) : 0;
  const currentPoints = weeklySessionPoints(logs);
  const latestSessions = currentPoints.at(-1)?.value ?? 0;
  const previousSessions = currentPoints.at(-2)?.value ?? 0;
  const sessionChange = previousSessions ? Math.round(((latestSessions - previousSessions) / previousSessions) * 100) : 0;
  const monthLogs = getMonthLogs(logs, new Date());
  const monthMinutes = monthLogs.reduce((sum, log) => sum + log.duration, 0);
  const streak = getStreak(routine, logs);
  const nextDateStart = new Date(next.date);
  nextDateStart.setHours(0, 0, 0, 0);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dateDistance = Math.round((nextDateStart.getTime() - todayStart.getTime()) / 86400000);
  const nextDateLabel = dateDistance === 0 ? 'HOY' : dateDistance === 1 ? 'MAÑANA' : DAY_NAMES[next.date.getDay()].toUpperCase();
  const consistency = getRecentConsistency(routine, logs);

  return (
    <div className="page-content dashboard-page">
      <section className="dashboard-intro">
        <p>{capitalize(esDate.format(new Date()))}</p>
        <div className="readiness-pill"><i /> Listo para avanzar</div>
      </section>

      <div className="dashboard-top-grid">
        <section className="next-workout-card">
          <div className="card-noise" />
          <div className="next-card-top">
            <span className="eyebrow-light">PRÓXIMO ENTRENAMIENTO · {nextDateLabel}</span>
            <span className="time-badge"><Clock3 size={14} /> {next.day.duration} min</span>
          </div>
          <div className="next-card-body">
            <div>
              <span className="focus-label">{next.day.focus}</span>
              <h2>{next.day.title}</h2>
              <p>{next.day.exercises.length} ejercicios · {next.day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0)} series de trabajo</p>
            </div>
            <button className="start-button" type="button" onClick={() => onStart(next.day, next.date)}>
              <span><Play size={19} fill="currentColor" /> Empezar</span>
              <ArrowRight size={20} />
            </button>
          </div>
          <div className="next-exercises">
            {next.day.exercises.slice(0, 3).map((exercise, index) => (
              <div key={exercise.id}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <p>{exercise.name}</p>
                <small>{exercise.sets} × {exercise.reps}</small>
              </div>
            ))}
            {next.day.exercises.length > 3 && <b>+{next.day.exercises.length - 3}</b>}
          </div>
        </section>

        <section className="card week-card">
          <div className="card-heading">
            <div>
              <span>ESTA SEMANA</span>
              <h3>{weekCompleted} de {weekPlanned} completados</h3>
            </div>
            <RingProgress value={completion} />
          </div>
          <WeekStrip routine={routine} logs={logs} />
          <button className="text-button" type="button" onClick={() => onNavigate('calendario')}>
            Ver calendario <ArrowRight size={15} />
          </button>
        </section>
      </div>

      <div className="metric-row">
        <div className="metric-card">
          <span className="metric-icon lime"><Dumbbell size={19} /></span>
          <div><small>ENTRENAMIENTOS</small><strong>{monthLogs.length}<em>este mes</em></strong></div>
        </div>
        <div className="metric-card">
          <span className="metric-icon lavender"><Flame size={19} /></span>
          <div><small>RACHA ACTUAL</small><strong>{streak}<em>sesiones</em></strong></div>
        </div>
        <div className="metric-card">
          <span className="metric-icon peach"><Clock3 size={19} /></span>
          <div><small>TIEMPO ENTRENADO</small><strong>{monthMinutes}<em>min este mes</em></strong></div>
        </div>
      </div>

      <div className="dashboard-bottom-grid">
        <section className="card progress-preview">
          <div className="card-heading simple">
            <div><span>SESIONES DE ENTRENAMIENTO</span><h3>Tu constancia, semana a semana</h3></div>
            <div className={`trend-pill ${sessionChange < 0 ? 'negative' : ''}`}>
              <TrendingUp size={14} /> {sessionChange >= 0 ? '+' : ''}{sessionChange}%
            </div>
          </div>
          <AreaChart points={currentPoints} compact emptyTitle="Aún no hay entrenamientos" emptyText="Tu actividad aparecerá aquí después de completar la primera sesión." />
          <button className="text-button chart-link" type="button" onClick={() => onNavigate('progreso')}>
            Analizar progreso <ArrowRight size={15} />
          </button>
        </section>

        <section className="card consistency-card">
          <div className="card-heading simple">
            <div><span>CONSISTENCIA</span><h3>Últimas 4 semanas</h3></div>
            <Target size={21} />
          </div>
          <div className="consistency-score">
            <strong>{consistency.score}<small>%</small></strong>
            <div>
              <span>{consistency.score >= 85 ? 'Excelente ritmo' : consistency.score >= 65 ? 'Buen ritmo' : 'Retoma el impulso'}</span>
              <p>Completaste {consistency.completed} de tus últimas {consistency.planned} sesiones.</p>
            </div>
          </div>
          <div className="consistency-bars">
            {consistency.values.map((value, index) => (
              <div key={`${value}-${index}`}>
                <i><b style={{ height: `${value}%` }} /></i>
                <span>S{index + 1}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function RoutineView({
  routine,
  logs,
  unit,
  onStart,
  onEdit,
  onImport,
  onDelete,
}: {
  routine: Routine;
  logs: WorkoutLog[];
  unit: Unit;
  onStart: (day: RoutineDay) => void;
  onEdit: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const [expandedDay, setExpandedDay] = useState(routine.days[0]?.id ?? '');
  const activeDay = routine.days.find((day) => day.id === expandedDay) ?? routine.days[0];

  return (
    <div className="page-content routine-page">
      <section className="routine-header-card">
        <div className="routine-file-icon"><FileText size={25} /></div>
        <div className="routine-header-copy">
          <span>RUTINA ACTIVA</span>
          <h2>{routine.name}</h2>
          <p>
            {routine.days.length} días por semana · {exerciseCount(routine)} ejercicios
            {routine.sourceName ? ` · Importada desde ${routine.sourceName}` : ''}
          </p>
        </div>
        <div className="routine-header-actions">
          <button className="button button-light" type="button" onClick={onEdit}><Pencil size={16} /> Editar</button>
          <button className="button button-dark" type="button" onClick={onImport}><Upload size={16} /> Nueva rutina</button>
          <button className="button button-danger routine-delete-button" type="button" onClick={onDelete} aria-label="Borrar rutina" title="Borrar rutina"><Trash2 size={16} /><span>Borrar rutina</span></button>
        </div>
      </section>

      <div className="section-heading">
        <div><span>DISTRIBUCIÓN SEMANAL</span><h2>Tu semana de entrenamiento</h2></div>
        <p>Selecciona un día para revisar los ejercicios y tus cargas anteriores.</p>
      </div>

      <div className="routine-day-tabs">
        {routine.days
          .slice()
          .sort((a, b) => (a.dayOfWeek || 7) - (b.dayOfWeek || 7))
          .map((day, index) => {
            const completedCount = logs.filter((log) => log.routineDayId === day.id).length;
            return (
              <button
                type="button"
                className={`routine-day-tab ${activeDay?.id === day.id ? 'active' : ''}`}
                key={day.id}
                onClick={() => setExpandedDay(day.id)}
                style={{ ['--tab-accent' as any]: day.color }}
              >
                <i aria-hidden style={{ background: day.color }} />
                <span>DÍA {index + 1} · {DAY_NAMES[day.dayOfWeek].toUpperCase()}</span>
                <strong>{day.title}</strong>
                <small>{day.focus || `${day.exercises.length} ejercicios`}</small>
                <em>{completedCount} registros</em>
              </button>
            );
          })}
      </div>

      {activeDay && (
        <section className="card exercise-table-card">
          <div className="exercise-table-header">
            <div>
              <span className="day-number" style={{ background: activeDay.color }}>{DAY_NAMES_SHORT[activeDay.dayOfWeek]}</span>
              <div>{activeDay.focus ? <small>{activeDay.focus}</small> : null}<h3>{activeDay.title}</h3></div>
            </div>
            <button className="button button-accent" type="button" onClick={() => onStart(activeDay)}>
              <Play size={16} fill="currentColor" /> Entrenar ahora
            </button>
          </div>
          <div className="exercise-table-labels">
            <span>EJERCICIO</span><span>OBJETIVO</span><span>ÚLTIMA CARGA</span><span>DESCANSO</span><span />
          </div>
          <div className="exercise-list">
            {activeDay.exercises.map((exercise, index) => {
              const previous = getLastExerciseSets(logs, exercise)?.find((set) => set.done);
              return (
                <div className="exercise-row" key={exercise.id}>
                  <div className="exercise-name-cell">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{exercise.name}</strong><small>{exercise.muscle || exercise.note || 'Serie de trabajo'}</small></div>
                  </div>
                  <div><strong>{exercise.sets} × {exercise.reps}</strong><small>series × reps</small></div>
                  <div><strong>{previous ? `${displayWeight(previous.weight, previous.unit, unit)} ${unit}` : 'Sin registro'}</strong><small>último entreno</small></div>
                  <div><strong>{exercise.rest} s</strong><small>entre series</small></div>
                  {exercise.link ? <a className="exercise-source-link" href={exercise.link} target="_blank" rel="noreferrer" aria-label={`Ver referencia de ${exercise.name}`}><ExternalLink size={16} /></a> : <ChevronRight size={18} />}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function monthGridDates(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function MiniMonth({
  month,
  logs,
  onClick,
}: {
  month: Date;
  logs: WorkoutLog[];
  onClick: () => void;
}) {
  const dates = monthGridDates(month);
  const logKeys = new Set(logs.map((log) => log.date));
  return (
    <button className="mini-month" type="button" onClick={onClick}>
      <strong>{capitalize(month.toLocaleDateString('es-ES', { month: 'long' }))}</strong>
      <div className="mini-weekdays">{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mini-grid">
        {dates.map((date) => {
          const muted = date.getMonth() !== month.getMonth();
          const trained = logKeys.has(localDateKey(date));
          return <i className={`${muted ? 'muted' : ''} ${trained ? 'trained' : ''}`} key={localDateKey(date)}>{muted ? '' : date.getDate()}</i>;
        })}
      </div>
    </button>
  );
}

function CalendarView({
  routine,
  logs,
  onStart,
}: {
  routine: Routine;
  logs: WorkoutLog[];
  onStart: (day: RoutineDay, date: Date) => void;
}) {
  const now = new Date();
  const [month, setMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(localDateKey(now));
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const dates = monthGridDates(month);
  const selectedDate = fromDateKey(selected);
  const selectedDay = getRoutineForDate(routine, selectedDate);
  const selectedLog = logs.find((log) => log.date === selected);
  const yearMonths = Array.from({ length: 12 }, (_, index) => new Date(month.getFullYear(), index, 1));

  function changeMonth(amount: number) {
    const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
    setMonth(next);
    setSelected(localDateKey(next));
  }

  return (
    <div className="page-content calendar-page">
      <div className="calendar-toolbar">
        <div className="view-switch">
          <button className={mode === 'month' ? 'active' : ''} type="button" onClick={() => setMode('month')}>Mes</button>
          <button className={mode === 'year' ? 'active' : ''} type="button" onClick={() => setMode('year')}>Año</button>
        </div>
        <div className="month-navigation">
          <button type="button" aria-label={mode === 'month' ? 'Mes anterior' : 'Año anterior'} onClick={() => {
            if (mode === 'month') changeMonth(-1);
            else {
              const next = new Date(month.getFullYear() - 1, month.getMonth(), 1);
              setMonth(next);
              setSelected(localDateKey(next));
            }
          }}><ChevronLeft size={19} /></button>
          <h2>{mode === 'month' ? capitalize(esMonth.format(month)) : month.getFullYear()}</h2>
          <button type="button" aria-label={mode === 'month' ? 'Mes siguiente' : 'Año siguiente'} onClick={() => {
            if (mode === 'month') changeMonth(1);
            else {
              const next = new Date(month.getFullYear() + 1, month.getMonth(), 1);
              setMonth(next);
              setSelected(localDateKey(next));
            }
          }}><ChevronRight size={19} /></button>
        </div>
        <button className="today-button" type="button" onClick={() => { setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localDateKey(now)); }}>Hoy</button>
      </div>

      {mode === 'year' ? (
        <section className="year-grid">
          {yearMonths.map((yearMonth) => (
            <MiniMonth
              key={yearMonth.getMonth()}
              month={yearMonth}
              logs={logs}
              onClick={() => { setMonth(yearMonth); setSelected(localDateKey(yearMonth)); setMode('month'); }}
            />
          ))}
        </section>
      ) : (
        <div className="calendar-layout">
          <section className="card month-calendar">
            <div className="calendar-weekdays">
              {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="calendar-grid">
              {dates.map((date) => {
                const key = localDateKey(date);
                const day = getRoutineForDate(routine, date);
                const log = logs.find((entry) => entry.date === key);
                const outside = date.getMonth() !== month.getMonth();
                const isToday = key === localDateKey(now);
                return (
                  <button
                    type="button"
                    key={key}
                    className={`calendar-cell ${outside ? 'outside' : ''} ${selected === key ? 'selected' : ''}`}
                    onClick={() => {
                      setSelected(key);
                      if (outside) setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
                    }}
                  >
                    <span className={isToday ? 'today-number' : ''}>{date.getDate()}</span>
                    {(day || log) && (
                      <div className={`calendar-event ${log ? 'done' : ''}`} style={{ '--event-color': day?.color ?? ACCENT_COLORS[0] } as React.CSSProperties}>
                        <i>{log ? <Check size={10} /> : <Dumbbell size={10} />}</i>
                        <strong>{log?.title ?? day?.title}</strong>
                        <small>{log ? `${log.duration} min` : 'Programado'}</small>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="card day-detail-card">
            <span className="detail-eyebrow">DÍA SELECCIONADO</span>
            <h3>{capitalize(esDate.format(selectedDate))}</h3>
            {(selectedDay || selectedLog) ? (
              <>
                <div className="detail-workout-title">
                  <i style={{ background: selectedDay?.color ?? ACCENT_COLORS[0] }}><Dumbbell size={18} /></i>
                  <div>
                    <strong>{selectedLog?.title ?? selectedDay?.title}</strong>
                    <span>{`${selectedDay?.exercises.length ?? selectedLog?.exercises.length ?? 0} ejercicios`}</span>
                  </div>
                  {selectedLog && <b><Check size={12} /> Completado</b>}
                </div>
                {selectedLog ? (
                  <div className="logged-summary">
                    <div><span>Duración</span><strong>{selectedLog.duration} min</strong></div>
                    <div><span>Ejercicios</span><strong>{selectedLog.exercises.length}</strong></div>
                    <div><span>Series</span><strong>{selectedLog.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.done).length, 0)}</strong></div>
                  </div>
                ) : (
                  <div className="planned-exercises">
                    {selectedDay?.exercises.map((exercise) => (
                      <div key={exercise.id}><span>{exercise.name}</span><strong>{exercise.sets} × {exercise.reps}</strong></div>
                    ))}
                  </div>
                )}
                {selectedDay ? (
                  <button className={`button ${selectedLog ? 'button-light' : 'button-dark'} full-button`} type="button" onClick={() => onStart(selectedDay, selectedDate)}>
                    {selectedLog ? <><RotateCcw size={16} /> Volver a registrar</> : <><Play size={16} fill="currentColor" /> Registrar entrenamiento</>}
                  </button>
                ) : (
                  <p className="archived-workout-note">Este entrenamiento pertenece a una rutina anterior y se conserva en tu historial.</p>
                )}
              </>
            ) : (
              <div className="rest-day">
                <span><Sparkles size={25} /></span>
                <strong>Día de recuperación</strong>
                <p>No hay entrenamiento programado. Descansa, muévete y vuelve con energía.</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function getExerciseOptions(routine: Routine) {
  const seen = new Set<string>();
  return routine.days.flatMap((day) => day.exercises).filter((exercise) => {
    if (seen.has(exercise.id)) return false;
    seen.add(exercise.id);
    return true;
  });
}

function exerciseProgressPoints(logs: WorkoutLog[], exercise: Exercise, unit: Unit): ChartPoint[] {
  return logs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((log) => {
      const result = log.exercises.find((entry) => entry.exerciseId === exercise.id || entry.exerciseName === exercise.name);
      if (!result) return [];
      const best = result.sets.filter((set) => set.done).reduce<SetLog | null>((current, set) => {
        const weight = convertWeight(set.weight, set.unit, unit);
        const currentWeight = current ? convertWeight(current.weight, current.unit, unit) : 0;
        return weight > currentWeight ? set : current;
      }, null);
      if (!best) return [];
      const bestWeight = convertWeight(best.weight, best.unit, unit);
      return [{ label: esShortDate.format(fromDateKey(log.date)), value: Math.round(bestWeight * 10) / 10, detail: `${Math.round(bestWeight * 10) / 10} ${unit} × ${best.reps} reps` }];
    })
    .slice(-8);
}

function ProgressView({ state, onStart }: { state: AppState; onStart: (day: RoutineDay) => void }) {
  const { routine, logs, unit } = state;
  const options = getExerciseOptions(routine);
  const [exerciseId, setExerciseId] = useState(options[0]?.id ?? '');
  const selectedExercise = options.find((exercise) => exercise.id === exerciseId) ?? options[0];
  const exercisePoints = selectedExercise ? exerciseProgressPoints(logs, selectedExercise, unit) : [];
  const points = exercisePoints;
  const firstValue = points[0]?.value ?? 0;
  const lastValue = points.at(-1)?.value ?? 0;
  const improvement = firstValue ? Math.round(((lastValue - firstValue) / firstValue) * 100) : 0;
  const monthLogs = getMonthLogs(logs, new Date());
  const monthMinutes = monthLogs.reduce((sum, log) => sum + log.duration, 0);
  const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const previousMinutes = getMonthLogs(logs, previousMonth).reduce((sum, log) => sum + log.duration, 0);
  const timeDelta = previousMinutes ? Math.round(((monthMinutes - previousMinutes) / previousMinutes) * 100) : 0;
  const allCompletedSets = monthLogs.flatMap((log) => log.exercises).flatMap((exercise) => exercise.sets).filter((set) => set.done);
  const recentLogs = logs.filter((log) => fromDateKey(log.date) >= addDays(new Date(), -28));
  const balanceTotal = recentLogs.reduce(
    (sum, log) => sum + log.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.filter((set) => set.done).length, 0),
    0,
  );
  const balanceData = routine.days.map((day) => {
    const sets = recentLogs
      .filter((log) => log.routineDayId === day.id)
      .reduce((sum, log) => sum + log.exercises.reduce((exerciseSum, exercise) => exerciseSum + exercise.sets.filter((set) => set.done).length, 0), 0);
    return {
      label: day.focus || day.title,
      value: balanceTotal ? Math.round((sets / balanceTotal) * 100) : 0,
      color: day.color,
    };
  });

  if (logs.length === 0) {
    return (
      <div className="page-content progress-page">
        <section className="card progress-first-session">
          <span><LineChart size={28} /></span>
          <small>PROGRESO SIN DATOS ARTIFICIALES</small>
          <h2>Aquí aparecerán tus propios resultados.</h2>
          <p>Ya importaste la rutina. Completa el primer entrenamiento para comenzar a registrar sesiones, series y evolución por ejercicio.</p>
          {routine.days[0] && <button className="button button-accent" type="button" onClick={() => onStart(routine.days[0])}><Play size={16} fill="currentColor" /> Iniciar primer entreno</button>}
        </section>
      </div>
    );
  }

  return (
    <div className="page-content progress-page">
      <div className="progress-summary-grid">
        <section className="summary-card dark-summary">
          <span>TIEMPO ESTE MES</span>
          <strong>{monthMinutes} <small>min</small></strong>
          <p className={timeDelta < 0 ? 'down' : ''}><TrendingUp size={15} /> {timeDelta >= 0 ? '+' : ''}{timeDelta}% vs. mes anterior</p>
          <div className="summary-watermark"><BarChart3 /></div>
        </section>
        <section className="summary-card">
          <span>SESIONES</span>
          <strong>{monthLogs.length}<small> / {routine.days.length * 4}</small></strong>
          <div className="summary-progress"><i style={{ width: `${Math.min(100, (monthLogs.length / Math.max(routine.days.length * 4, 1)) * 100)}%` }} /></div>
          <p>Objetivo mensual</p>
        </section>
        <section className="summary-card">
          <span>SERIES COMPLETADAS</span>
          <strong>{allCompletedSets.length}</strong>
          <p><Check size={15} /> Trabajo efectivo registrado</p>
        </section>
        <section className="summary-card">
          <span>MEJOR RACHA</span>
          <strong>{getBestStreak(routine, logs)} <small>sesiones</small></strong>
          <p><Flame size={15} /> Mantén la constancia</p>
        </section>
      </div>

      <section className="card main-progress-chart">
        <div className="progress-chart-header">
          <div>
            <span>PROGRESIÓN DE FUERZA</span>
            <h2>{selectedExercise?.name ?? 'Selecciona un ejercicio'}</h2>
            <p>Mayor carga que registraste realmente en cada entrenamiento.</p>
          </div>
          <div className="chart-controls">
            <label>
              <Dumbbell size={16} />
              <select value={exerciseId} onChange={(event) => setExerciseId(event.target.value)}>
                {options.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            <div className="improvement-badge"><TrendingUp size={15} /><span><b>{improvement >= 0 ? '+' : ''}{improvement}%</b> en {points.length} registros</span></div>
          </div>
        </div>
        {points.length > 0 && <div className="chart-value-row"><strong>{lastValue.toFixed(1)} <small>{unit}</small></strong><span>mejor carga reciente</span></div>}
        <AreaChart points={points} />
      </section>

      <div className="progress-detail-grid">
        <section className="card personal-bests">
          <div className="card-heading simple"><div><span>MARCAS RECIENTES</span><h3>Mejores cargas registradas</h3></div><Activity size={20} /></div>
          {options.slice(0, 4).map((exercise, index) => {
            const exerciseData = exerciseProgressPoints(logs, exercise, unit);
            const best = Math.max(...exerciseData.map((point) => point.value), 0);
            return (
              <div className="best-row" key={exercise.id}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{exercise.name}</strong><small>Mejor serie registrada</small></div>
                <b>{best > 0 ? `${best.toFixed(1)} ${unit}` : 'Sin registro'}</b>
                <TrendingUp size={15} />
              </div>
            );
          })}
        </section>
        <section className="card muscle-balance">
          <div className="card-heading simple"><div><span>DISTRIBUCIÓN</span><h3>Balance de entrenamiento</h3></div><Target size={20} /></div>
          {balanceData.map(({ label, value, color }) => (
            <div className="balance-row" key={label}>
              <div><span>{label}</span><strong>{value}%</strong></div>
              <i><b style={{ width: `${value}%`, background: color }} /></i>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function WorkoutSession({
  active,
  logs,
  unit,
  onClose,
  onFinish,
}: {
  active: ActiveWorkout;
  logs: WorkoutLog[];
  unit: Unit;
  onClose: () => void;
  onFinish: (log: WorkoutLog) => void;
}) {
  const existingWorkout = logs.find((log) => log.date === active.date && log.routineDayId === active.day.id);
  const restoredDraft = useMemo(() => {
    const saved = readWorkoutDraft();
    if (saved?.routineDayId !== active.day.id || saved.date !== active.date) return null;
    const hasCurrentExercises = active.day.exercises.every((exercise) =>
      saved.exerciseLogs.some((entry) => entry.exerciseId === exercise.id || entry.exerciseName === exercise.name),
    );
    return hasCurrentExercises ? saved : null;
  }, [active.date, active.day.exercises, active.day.id]);
  const [seconds, setSeconds] = useState(restoredDraft?.seconds ?? 0);
  const [activeExercise, setActiveExercise] = useState(0);
  const [showExit, setShowExit] = useState(false);
  const [exerciseLogs, setExerciseLogs] = useState<ExerciseLog[]>(() => {
    if (restoredDraft) {
      return active.day.exercises.map((exercise) => {
        const saved = restoredDraft.exerciseLogs.find((entry) => entry.exerciseId === exercise.id || entry.exerciseName === exercise.name)!;
        return {
          ...saved,
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          sets: saved.sets.map((set) => ({ ...set, weight: displayWeight(set.weight, set.unit, unit), unit })),
        };
      });
    }
    return active.day.exercises.map((exercise) => {
      const existing = existingWorkout
        ?.exercises.find((entry) => entry.exerciseId === exercise.id || entry.exerciseName === exercise.name)
        ?.sets;
      const previous = existing ?? getLastExerciseSets(logs, exercise, active.date);
      return {
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        sets: Array.from({ length: Math.max(exercise.sets, existing?.length ?? 0) }, (_, index) => {
          const previousSet = previous?.[index] ?? previous?.[0];
          return {
            weight: previousSet ? displayWeight(previousSet.weight, previousSet.unit, unit) : 0,
            reps: previousSet?.reps ?? parseTargetReps(exercise.reps),
            done: existing ? previousSet?.done ?? false : false,
            unit,
          };
        }),
      };
    });
  });

  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_WORKOUT_KEY, JSON.stringify({
        routineDayId: active.day.id,
        date: active.date,
        seconds,
        exerciseLogs,
        savedAt: new Date().toISOString(),
      } satisfies StoredWorkoutDraft));
    } catch {
      // The active session still works when browser storage is unavailable.
    }
  }, [active.date, active.day.id, exerciseLogs, seconds]);

  const totalSets = exerciseLogs.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const completedSets = exerciseLogs.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.done).length, 0);
  const progress = totalSets ? (completedSets / totalSets) * 100 : 0;
  const exercise = active.day.exercises[activeExercise];
  const currentLog = exerciseLogs[activeExercise];
  const previous = exercise ? getLastExerciseSets(logs, exercise, active.date) : undefined;
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const timerSeconds = String(seconds % 60).padStart(2, '0');

  function updateSet(setIndex: number, patch: Partial<SetLog>) {
    setExerciseLogs((current) => current.map((entry, exerciseIndex) =>
      exerciseIndex === activeExercise
        ? { ...entry, sets: entry.sets.map((set, index) => index === setIndex ? { ...set, ...patch } : set) }
        : entry,
    ));
  }

  function addSet() {
    setExerciseLogs((current) => current.map((entry, index) => {
      if (index !== activeExercise) return entry;
      const last = entry.sets.at(-1);
      return { ...entry, sets: [...entry.sets, { weight: last?.weight ?? 0, reps: last?.reps ?? parseTargetReps(exercise.reps), done: false, unit }] };
    }));
  }

  function finish() {
    if (completedSets !== totalSets) return;
    clearWorkoutDraft();
    onFinish({
      id: existingWorkout?.id ?? uid('workout'),
      date: active.date,
      routineDayId: active.day.id,
      title: active.day.title,
      duration: Math.max(existingWorkout?.duration ?? 0, Math.max(1, Math.round(seconds / 60))),
      exercises: exerciseLogs,
      completed: true,
    });
  }

  return (
    <div className="workout-overlay">
      <div className="workout-shell">
        <header className="workout-header">
          <div className="workout-brand"><Logo compact /><span>ENTRENAMIENTO ACTIVO</span></div>
          <div className="workout-timer"><Clock3 size={17} /><strong>{minutes}:{timerSeconds}</strong></div>
          <div className="workout-header-actions">
            <button className="workout-header-finish" type="button" disabled={completedSets !== totalSets} onClick={finish} title={completedSets !== totalSets ? `Faltan ${totalSets - completedSets} series` : 'Finalizar entrenamiento'}><Check size={17} /> <span>Finalizar</span></button>
            <button className="workout-close" type="button" onClick={() => setShowExit(true)}><X size={21} /> <span>Salir</span></button>
          </div>
        </header>
        <div className="workout-progress"><i style={{ width: `${progress}%` }} /></div>

        <div className="workout-body">
          <aside className="workout-exercise-nav">
            <div className="workout-day-title">
              <span>{DAY_NAMES[active.day.dayOfWeek]} · {active.day.focus}</span>
              <h2>{active.day.title}</h2>
              <p>{completedSets} de {totalSets} series completadas</p>
            </div>
            <div className="exercise-nav-list">
              {active.day.exercises.map((item, index) => {
                const completed = exerciseLogs[index].sets.filter((set) => set.done).length;
                const allDone = completed === exerciseLogs[index].sets.length;
                return (
                  <button
                    type="button"
                    className={activeExercise === index ? 'active' : ''}
                    key={item.id}
                    onClick={() => setActiveExercise(index)}
                  >
                    <i className={allDone ? 'done' : ''}>{allDone ? <Check size={14} /> : String(index + 1).padStart(2, '0')}</i>
                    <div><strong>{item.name}</strong><span>{completed}/{exerciseLogs[index].sets.length} series</span></div>
                    <ChevronRight size={17} />
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="workout-main">
            <div className="current-exercise-heading">
              <div>
                <span>EJERCICIO {activeExercise + 1} DE {active.day.exercises.length}</span>
                <h1>{exercise.name}</h1>
                <p>{exercise.sets} series · {exercise.reps} repeticiones · {exercise.rest} s descanso</p>
              </div>
              <div className="exercise-target"><Target size={19} /><div><span>OBJETIVO</span><strong>{exercise.sets} × {exercise.reps}</strong></div></div>
            </div>

            <div className="set-table">
              <div className="set-table-head"><span>SERIE</span><span>ANTERIOR</span><span>PESO ({unit.toUpperCase()})</span><span>REPS</span><span>LISTA</span></div>
              {currentLog.sets.map((set, index) => {
                const previousSet = previous?.[index];
                return (
                  <div className={`set-row ${set.done ? 'done' : ''}`} key={index}>
                    <span className="set-number">{index + 1}</span>
                    <span className="previous-set">{previousSet ? `${displayWeight(previousSet.weight, previousSet.unit, unit)} × ${previousSet.reps}` : '—'}</span>
                    <label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={set.weight || ''}
                        onChange={(event) => updateSet(index, { weight: Number(event.target.value) })}
                        aria-label={`Peso de la serie ${index + 1}`}
                      />
                      <small>{unit}</small>
                    </label>
                    <label>
                      <input
                        type="number"
                        min="0"
                        value={set.reps || ''}
                        onChange={(event) => updateSet(index, { reps: Number(event.target.value) })}
                        aria-label={`Repeticiones de la serie ${index + 1}`}
                      />
                      <small>reps</small>
                    </label>
                    <button type="button" className="set-check" onClick={() => updateSet(index, { done: !set.done })} aria-label={`Completar serie ${index + 1}`}>
                      <Check size={19} />
                    </button>
                    {previousSet && <span className="previous-hint"><TrendingUp size={10} /> Anterior: {displayWeight(previousSet.weight, previousSet.unit, unit)} {unit} × {previousSet.reps} — supera</span>}
                  </div>
                );
              })}
            </div>
            <button className="add-set-button" type="button" onClick={addSet}><Plus size={16} /> Añadir serie</button>

            <div className="workout-tip"><Sparkles size={17} /><p><strong>Consejo de Trazza+</strong> Mantén 1–2 repeticiones en reserva y prioriza una técnica consistente.</p></div>

            <div className="workout-footer-actions">
              <button
                className="button button-light"
                type="button"
                disabled={activeExercise === 0}
                onClick={() => setActiveExercise((value) => Math.max(0, value - 1))}
              ><ChevronLeft size={17} /> Anterior</button>
              {activeExercise < active.day.exercises.length - 1 ? (
                <button className="button button-dark" type="button" onClick={() => setActiveExercise((value) => value + 1)}>Siguiente ejercicio <ArrowRight size={17} /></button>
              ) : (
                <button className="button button-accent" type="button" title={completedSets !== totalSets ? 'Completa todas las series para finalizar' : undefined} disabled={completedSets !== totalSets} onClick={finish}><Check size={17} /> Finalizar entrenamiento</button>
              )}
            </div>
          </main>
        </div>
      </div>

      {showExit && (
        <div className="confirm-overlay" onMouseDown={(event) => event.target === event.currentTarget && setShowExit(false)}>
          <div className="confirm-dialog">
            <span><Clock3 size={24} /></span>
            <h3>¿Pausar entrenamiento?</h3>
            <p>Tu avance se guarda automáticamente. Puedes retomarlo al abrir de nuevo este entrenamiento.</p>
            <div className="confirm-actions">
              <button className="button button-dark" type="button" onClick={() => setShowExit(false)}>Continuar</button>
              <button className="button button-light" type="button" onClick={onClose}>Guardar y salir</button>
            </div>
            <button className="discard-session" type="button" onClick={() => { clearWorkoutDraft(); onClose(); }}>Descartar esta sesión</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RoutineBuilderModal({
  initialRoutine,
  onClose,
  onSave,
}: {
  initialRoutine?: Routine;
  onClose: () => void;
  onSave: (routine: Routine) => void;
}) {
  const [stage, setStage] = useState<'upload' | 'parsing' | 'review' | 'error'>(initialRoutine ? 'review' : 'upload');
  const [draft, setDraft] = useState<Routine | null>(initialRoutine ? cloneRoutine(initialRoutine) : null);
  const [fileName, setFileName] = useState(initialRoutine?.sourceName ?? '');
  const [fileSize, setFileSize] = useState('');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function processFile(file?: File) {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Selecciona un archivo en formato PDF.');
      setStage('error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError('El PDF supera el límite de 15 MB.');
      setStage('error');
      return;
    }
    setFileName(file.name);
    setFileSize(`${(file.size / 1024 / 1024).toFixed(1)} MB`);
    setStage('parsing');
    try {
      const { parseRoutinePdf } = await import('./pdf');
      const parsed = await parseRoutinePdf(file);
      setDraft(routineFromParsed(parsed, file.name));
      setStage('review');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No fue posible procesar el PDF.');
      setStage('error');
    }
  }

  function createManual() {
    setFileName('Rutina creada manualmente');
    setDraft({
      id: uid('routine'),
      name: 'Mi nueva rutina',
      importedAt: new Date().toISOString(),
      days: [{
        id: uid('day'),
        dayOfWeek: 1,
        title: 'Entrenamiento 1',
        focus: '',
        color: ACCENT_COLORS[0],
        duration: 55,
        exercises: [{ id: uid('exercise'), name: 'Nuevo ejercicio', sets: 3, reps: '8–12', rest: 180 }],
      }],
    });
    setStage('review');
  }

  function updateDay(dayId: string, updater: (day: RoutineDay) => RoutineDay) {
    setDraft((current) => current ? { ...current, days: current.days.map((day) => day.id === dayId ? updater(day) : day) } : current);
  }

  function addExercise(dayId: string) {
    updateDay(dayId, (day) => ({
      ...day,
      exercises: [...day.exercises, { id: uid('exercise'), name: 'Nuevo ejercicio', sets: 3, reps: '8–12', rest: 180 }],
    }));
  }

  function addDay() {
    setDraft((current) => {
      if (!current) return current;
      if (current.days.length >= 7) return current;
      const used = new Set(current.days.map((day) => day.dayOfWeek));
      const available = [1, 2, 3, 4, 5, 6, 0].find((day) => !used.has(day)) ?? 1;
      return {
        ...current,
        days: [...current.days, {
          id: uid('day'),
          dayOfWeek: available,
          title: `Entrenamiento ${current.days.length + 1}`,
          focus: '',
          color: ACCENT_COLORS[current.days.length % ACCENT_COLORS.length],
          duration: 55,
          exercises: [{ id: uid('exercise'), name: 'Nuevo ejercicio', sets: 3, reps: '8–12', rest: 180 }],
        }],
      };
    });
  }

  function save() {
    if (!draft || !draft.name.trim() || draft.days.length === 0) {
      setError('Completa el nombre de la rutina, los días y todos los ejercicios.');
      return;
    }
    const weekdays = draft.days.map((day) => day.dayOfWeek);
    if (new Set(weekdays).size !== weekdays.length) {
      setError('Cada entrenamiento debe estar asignado a un día diferente.');
      return;
    }
    const hasInvalidExercise = draft.days.some((day) =>
      !day.title.trim() ||
      day.exercises.length === 0 ||
      day.exercises.some((exercise) =>
        !exercise.name.trim() ||
        !exercise.reps.trim() ||
        !Number.isInteger(exercise.sets) ||
        exercise.sets < 1 ||
        exercise.sets > 10 ||
        !Number.isFinite(exercise.rest) ||
        exercise.rest < 0,
      ),
    );
    if (hasInvalidExercise) {
      setError('Revisa nombres, repeticiones, series (1–10) y tiempos de descanso.');
      return;
    }
    onSave({ ...draft, name: draft.name.trim() });
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`routine-modal ${stage === 'review' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="routine-modal-title">
        <div className="modal-header">
          <div>
            <span>{initialRoutine ? 'CONFIGURAR PLAN' : 'IMPORTAR RUTINA'}</span>
            <h2 id="routine-modal-title">{stage === 'review' ? 'Revisa tu rutina' : 'Convierte tu PDF en un plan'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar"><X size={21} /></button>
        </div>

        {stage === 'upload' && (
          <div className="upload-stage">
            <p>Sube la rutina que te entregó tu entrenador. Trazza+ identificará los días, ejercicios, series y repeticiones.</p>
            <div
              className={`drop-zone ${dragging ? 'dragging' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); void processFile(event.dataTransfer.files[0]); }}
            >
              <input ref={inputRef} type="file" accept="application/pdf,.pdf" onChange={(event: ChangeEvent<HTMLInputElement>) => void processFile(event.target.files?.[0])} />
              <span className="upload-icon"><Upload size={25} /></span>
              <h3>Arrastra tu rutina aquí</h3>
              <p>o selecciona un archivo desde tu equipo</p>
              <button className="button button-dark" type="button" onClick={() => inputRef.current?.click()}>Seleccionar PDF</button>
              <small>PDF con texto seleccionable · Máximo 15 MB</small>
            </div>
            <div className="privacy-note"><Check size={15} /><span><strong>Tu información es privada.</strong> El archivo se procesa en este dispositivo y no se comparte.</span></div>
            <button className="manual-link" type="button" onClick={createManual}>No tengo un PDF, crear rutina manualmente <ArrowRight size={14} /></button>
          </div>
        )}

        {stage === 'parsing' && (
          <div className="parsing-stage">
            <div className="document-animation"><FileText size={38} /><i /><i /><i /></div>
            <span>LEYENDO TU RUTINA</span>
            <h3>Organizando los ejercicios...</h3>
            <p>{fileName} · {fileSize}</p>
            <div className="parse-progress"><i /></div>
            <small>Detectando días, series y repeticiones</small>
          </div>
        )}

        {stage === 'error' && (
          <div className="error-stage">
            <span><FileText size={28} /></span>
            <h3>No pudimos leer esta rutina</h3>
            <p>{error}</p>
            <div><button className="button button-light" type="button" onClick={() => { setStage('upload'); setError(''); }}>Intentar con otro PDF</button><button className="button button-dark" type="button" onClick={createManual}>Crear manualmente</button></div>
          </div>
        )}

        {stage === 'review' && draft && (
          <div className="review-stage">
            <div className="extraction-success">
              <span><Check size={16} /></span>
              <p><strong>{initialRoutine ? 'Editando tu plan actual' : 'Rutina procesada correctamente'}</strong>{fileName && <> · {fileName}</>}</p>
              <small>{draft.days.length} días · {exerciseCount(draft)} ejercicios</small>
            </div>
            <label className="field routine-name-field"><span>NOMBRE DE LA RUTINA</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <div className="routine-editor-days">
              {draft.days.map((day, dayIndex) => (
                <section className="editor-day" key={day.id}>
                  <div className="editor-day-heading">
                    <i style={{ background: day.color }}>{dayIndex + 1}</i>
                    <label className="field"><span>DÍA</span><select value={day.dayOfWeek} onChange={(event) => updateDay(day.id, (current) => ({ ...current, dayOfWeek: Number(event.target.value) }))}>{[1, 2, 3, 4, 5, 6, 0].map((value) => <option key={value} value={value}>{DAY_NAMES[value]}</option>)}</select></label>
                    <label className="field grow"><span>NOMBRE DEL ENTRENO</span><input value={day.title} onChange={(event) => updateDay(day.id, (current) => ({ ...current, title: event.target.value }))} /></label>
                    <button type="button" aria-label="Eliminar día" onClick={() => setDraft({ ...draft, days: draft.days.filter((item) => item.id !== day.id) })}><Trash2 size={17} /></button>
                  </div>
                  <div className="editor-exercise-labels"><span>EJERCICIO</span><span>SERIES</span><span>REPETICIONES</span><span /></div>
                  {day.exercises.map((exercise) => (
                    <div className="editor-exercise" key={exercise.id}>
                      <textarea rows={2} value={exercise.name} title={exercise.muscle ? `${exercise.name} · ${exercise.muscle}` : exercise.name} aria-label="Nombre del ejercicio" onChange={(event) => updateDay(day.id, (current) => ({ ...current, exercises: current.exercises.map((item) => item.id === exercise.id ? { ...item, name: event.target.value } : item) }))} />
                      <label className="editor-exercise-control"><span>Series</span><input type="number" min="1" max="10" value={exercise.sets} aria-label="Series" onChange={(event) => updateDay(day.id, (current) => ({ ...current, exercises: current.exercises.map((item) => item.id === exercise.id ? { ...item, sets: Number(event.target.value) } : item) }))} /></label>
                      <label className="editor-exercise-control"><span>Repeticiones</span><input value={exercise.reps} aria-label="Repeticiones" onChange={(event) => updateDay(day.id, (current) => ({ ...current, exercises: current.exercises.map((item) => item.id === exercise.id ? { ...item, reps: event.target.value } : item) }))} /></label>
                      <button type="button" aria-label="Eliminar ejercicio" onClick={() => updateDay(day.id, (current) => ({ ...current, exercises: current.exercises.filter((item) => item.id !== exercise.id) }))}><X size={16} /></button>
                    </div>
                  ))}
                  <button className="add-exercise-link" type="button" onClick={() => addExercise(day.id)}><Plus size={14} /> Añadir ejercicio</button>
                </section>
              ))}
            </div>
            <button className="add-day-button" type="button" disabled={draft.days.length >= 7} onClick={addDay}><Plus size={16} /> {draft.days.length >= 7 ? 'Semana completa' : 'Añadir otro día'}</button>
            {error && <p className="form-error">{error}</p>}
            <div className="modal-footer">
              <button className="button button-light" type="button" onClick={onClose}>Cancelar</button>
              <button className="button button-accent" type="button" onClick={save}><Check size={17} /> {initialRoutine ? 'Guardar cambios' : 'Importar al sistema'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function DeleteRoutineModal({
  routineName,
  onClose,
  onConfirm,
}: {
  routineName: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop delete-routine-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="delete-routine-modal" role="dialog" aria-modal="true" aria-labelledby="delete-routine-title" aria-describedby="delete-routine-description">
        <button className="delete-routine-close" type="button" onClick={onClose} aria-label="Cerrar"><X size={19} /></button>
        <div className="delete-routine-icon"><Trash2 size={24} /></div>
        <span>ELIMINAR RUTINA</span>
        <h2 id="delete-routine-title">¿Borrar esta rutina?</h2>
        <p id="delete-routine-description">Se eliminará la rutina <strong>{routineName}</strong> y todo su historial asociado. Esta acción no se puede deshacer.</p>
        <div className="delete-routine-actions">
          <button className="button button-light" type="button" onClick={onClose}>Cancelar</button>
          <button className="button button-danger" type="button" onClick={onConfirm}><Trash2 size={16} /> Borrar rutina</button>
        </div>
      </section>
    </div>
  );
}

function CompletionModal({ log, onClose }: { log: WorkoutLog; onClose: () => void }) {
  const sets = log.exercises.reduce((sum, exercise) => sum + exercise.sets.filter((set) => set.done).length, 0);
  return (
    <div className="modal-backdrop completion-backdrop">
      <section className="completion-modal">
        <div className="completion-burst"><Check size={33} strokeWidth={2.5} /></div>
        <span>ENTRENAMIENTO COMPLETADO</span>
        <h2>Trabajo hecho.</h2>
        <p>Cada sesión registrada hace visible tu progreso. Sigue así.</p>
        <div className="completion-stats">
          <div><Clock3 size={18} /><strong>{log.duration}</strong><span>minutos</span></div>
          <div><Dumbbell size={18} /><strong>{sets}</strong><span>series</span></div>
          <div><ListChecks size={18} /><strong>{log.exercises.length}</strong><span>ejercicios</span></div>
        </div>
        <button className="button button-dark full-button" type="button" onClick={onClose}>Volver al inicio <ArrowRight size={17} /></button>
      </section>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return <div className="toast"><span><Check size={14} /></span>{message}</div>;
}

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [authUser, setAuthUser] = useState<AuthUser | null>(readAuthUser);
  const [page, setPage] = useState<Page>('inicio');
  const [builderMode, setBuilderMode] = useState<'import' | 'edit' | null>(null);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkout | null>(() => {
    const saved = readWorkoutDraft();
    if (!saved) return null;
    const day = state.routine.days.find((routineDay) => routineDay.id === saved.routineDayId);
    if (day) return { day, date: saved.date };
    clearWorkoutDraft();
    return null;
  });
  const [completedLog, setCompletedLog] = useState<WorkoutLog | null>(null);
  const [toast, setToast] = useState('');
  const [deleteRoutineOpen, setDeleteRoutineOpen] = useState(false);

  useEffect(() => {
    if (!saveState(state)) setToast('No se pudieron guardar los cambios en este navegador.');
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function startWorkout(day: RoutineDay, date = new Date()) {
    setActiveWorkout({ day, date: localDateKey(date) });
  }

  function finishWorkout(log: WorkoutLog) {
    setState((current) => ({
      ...current,
      logs: [...current.logs.filter((entry) => !(entry.date === log.date && entry.routineDayId === log.routineDayId)), log],
    }));
    setActiveWorkout(null);
    setCompletedLog(log);
  }

  function saveRoutine(routine: Routine) {
    setState((current) => ({ ...current, routine }));
    setBuilderMode(null);
    setToast('Rutina guardada correctamente');
    setPage('rutina');
  }

  function requestDeleteRoutine() {
    setDeleteRoutineOpen(true);
  }

  function deleteRoutine() {
    const emptyState = createInitialState();
    clearWorkoutDraft();
    setState((current) => ({ ...current, routine: emptyState.routine, logs: [] }));
    setBuilderMode(null);
    setDeleteRoutineOpen(false);
    setCompletedLog(null);
    setActiveWorkout(null);
    setPage('inicio');
    setToast('Rutina eliminada');
  }

  function login(user: AuthUser, remember: boolean) {
    storeAuthUser(user, remember);
    setAuthUser(user);
  }

  function logout() {
    clearAuthUser();
    setBuilderMode(null);
    setDeleteRoutineOpen(false);
    setCompletedLog(null);
    setActiveWorkout(null);
    setPage('inicio');
    setAuthUser(null);
  }

  if (!authUser) return <LoginScreen onLogin={login} />;

  const hasRoutine = state.routine.days.length > 0;
  const pausedDraft = readWorkoutDraft();
  const pausedDay = pausedDraft ? state.routine.days.find((day) => day.id === pausedDraft.routineDayId) : undefined;
  const quickWorkout = pausedDay && pausedDraft
    ? { day: pausedDay, date: fromDateKey(pausedDraft.date) }
    : getNextWorkout(state.routine, state.logs);

  let content: ReactNode;
  if (!hasRoutine) {
    content = <EmptyRoutineState page={page} onImport={() => setBuilderMode('import')} />;
  } else if (page === 'rutina') {
    content = <RoutineView routine={state.routine} logs={state.logs} unit={state.unit} onStart={startWorkout} onEdit={() => setBuilderMode('edit')} onImport={() => setBuilderMode('import')} onDelete={requestDeleteRoutine} />;
  } else if (page === 'calendario') {
    content = <CalendarView routine={state.routine} logs={state.logs} onStart={startWorkout} />;
  } else if (page === 'progreso') {
    content = <ProgressView state={state} onStart={startWorkout} />;
  } else {
    content = <Dashboard state={state} onStart={startWorkout} onNavigate={setPage} onImport={() => setBuilderMode('import')} />;
  }

  return (
    <div className="app-shell">
      <Sidebar page={page} user={authUser} onNavigate={setPage} onLogout={logout} />
      <main className="app-main">
        <Topbar
          page={page}
          unit={state.unit}
          user={authUser}
           onToggleUnit={() => setState((current) => ({ ...current, unit: current.unit === 'kg' ? 'lb' : 'kg' }))}
           onImport={() => setBuilderMode('import')}
           onNotify={() => setToast('Todo al día. Tu próxima sesión está lista.')}
           onLogout={logout}
           onStartWorkout={() => quickWorkout ? startWorkout(quickWorkout.day, quickWorkout.date) : setBuilderMode('import')}
          workoutActionLabel={!hasRoutine ? 'Subir rutina' : pausedDay ? 'Continuar entreno' : 'Iniciar entreno'}
          hasRoutine={hasRoutine}
        />
        {content}
      </main>
      {builderMode && <RoutineBuilderModal initialRoutine={builderMode === 'edit' ? state.routine : undefined} onClose={() => setBuilderMode(null)} onSave={saveRoutine} />}
      {deleteRoutineOpen && <DeleteRoutineModal routineName={state.routine.name} onClose={() => setDeleteRoutineOpen(false)} onConfirm={deleteRoutine} />}
      {activeWorkout && <WorkoutSession active={activeWorkout} logs={state.logs} unit={state.unit} onClose={() => setActiveWorkout(null)} onFinish={finishWorkout} />}
      {completedLog && <CompletionModal log={completedLog} onClose={() => { setCompletedLog(null); setPage('inicio'); }} />}
      {toast && <Toast message={toast} />}
    </div>
  );
}
