import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, Award, Check, Dumbbell, Flame, Heart, LockKeyhole, RefreshCw, Sparkles, TrendingUp, Users } from 'lucide-react';
import type { AuthUser, WorkoutLog } from '../types';
import type { BadgeId, SocialAction, SocialDashboard, SocialWorkoutDetail } from '../socialTypes';
import { ApiError } from '../api';
import { boundedSocialRequest } from '../socialRequest';
import './FriendsView.css';

export type FriendsViewProps = {
  user: AuthUser;
  logs: WorkoutLog[];
  load: (signal?: AbortSignal) => Promise<SocialDashboard>;
  act: (action: SocialAction, signal?: AbortSignal) => Promise<SocialDashboard>;
  search: (email: string, signal?: AbortSignal) => Promise<AuthUser[]>;
  detail: (postId: string, signal?: AbortSignal) => Promise<SocialWorkoutDetail>;
  onViewWorkout: (detail: SocialWorkoutDetail, returnFocus: HTMLElement | null) => void;
};
type Tab = 'Comunidad' | 'Amigos' | 'Insignias' | 'Metas';
const tabs: Tab[] = ['Comunidad', 'Amigos', 'Insignias', 'Metas'];
const dateLabel = (date: string) => {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Fecha no disponible' : value.toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric', ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { timeZone: 'UTC' } : {}) });
};
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;

export function FriendsView({ user, logs, load, act: sendAction, search, detail, onViewWorkout }: FriendsViewProps) {
  const id = useId();
  const [data, setData] = useState<SocialDashboard | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tab, setTab] = useState<Tab>('Comunidad');
  const [email, setEmail] = useState('');
  const [people, setPeople] = useState<AuthUser[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<AuthUser | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [workoutId, setWorkoutId] = useState('');
  const [workoutDescription, setWorkoutDescription] = useState('');
  const [badgeDescription, setBadgeDescription] = useState('');
  const [removeEmail, setRemoveEmail] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState('8');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [shared, setShared] = useState(false);
  const alive = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    alive.current = true;
    const token = ++generation.current;
    const request = new AbortController();
    controller.current = request;
    busy.current = true;
    setPending(true); setData(null); setError(''); setNotice('');
    setEmail(''); setRemoveEmail(null); setWorkoutId('');
    setWorkoutDescription(''); setBadgeDescription('');
    setTitle(''); setTarget('8'); setStartDate(''); setEndDate(''); setShared(false);
    void (async () => {
      try {
        const result = await boundedSocialRequest(() => load(request.signal), request);
        if (alive.current && generation.current === token && !request.signal.aborted) setData(result);
      } catch (reason) {
        if (alive.current && generation.current === token) setError(reason instanceof ApiError ? reason.message : 'No pudimos cargar tu comunidad. Inténtalo de nuevo.');
      } finally {
        if (alive.current && generation.current === token) { busy.current = false; setPending(false); }
      }
    })();
    return () => { alive.current = false; ++generation.current; request.abort(); controller.current?.abort(); busy.current = false; };
  }, [load, user.email]);

  useEffect(() => {
    const query = email.trim().toLowerCase();
    const abort = new AbortController();
    setPeople([]); setSearchNotice(''); setSearching(false);
    if (tab !== 'Amigos' || selectedPerson || query === user.email.toLowerCase() || query.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) return;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void search(query, abort.signal).then(result => {
        if (abort.signal.aborted) return;
        setPeople(result); setHighlighted(0);
        setSearchNotice(result.length ? 'Cuenta encontrada. Selecciónala para enviar la solicitud.' : 'No encontramos una cuenta con ese correo.');
      }).catch(reason => {
        if (!abort.signal.aborted) setSearchNotice(reason instanceof ApiError ? reason.message : 'No pudimos buscar la cuenta. Revisa el correo e inténtalo de nuevo.');
      }).finally(() => { if (!abort.signal.aborted) setSearching(false); });
    }, 400);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [email, search, selectedPerson, tab, user.email]);

  async function request(action?: SocialAction, message = 'Comunidad actualizada.') {
    if (!alive.current || busy.current) return false;
    busy.current = true;
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setPending(true); setError(''); setNotice('');
    try {
      const result = await boundedSocialRequest(() => action ? sendAction(action, abort.signal) : load(abort.signal), abort);
      if (!alive.current || generation.current !== token || abort.signal.aborted) return false;
      setData(result); setNotice(message);
      return true;
    } catch (reason) {
      if (alive.current && generation.current === token) setError(reason instanceof ApiError ? reason.message : 'No pudimos confirmar la operación. Actualiza para comprobar el estado y vuelve a intentarlo.');
      return false;
    } finally {
      if (alive.current && generation.current === token) { busy.current = false; setPending(false); }
    }
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const normalized = email.trim().toLowerCase();
    if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized === user.email.toLowerCase()) {
      setError('Escribe un correo válido de otra persona (máximo 254 caracteres).'); return;
    }
    if (!selectedPerson || selectedPerson.email !== normalized) { setError('Selecciona la cuenta encontrada antes de enviar la solicitud.'); return; }
    if (await request({ type: 'invite', email: selectedPerson.email }, 'Solicitud enviada dentro de Kyon. La otra persona puede aceptarla en Amigos.')) { setEmail(''); setSelectedPerson(null); }
  }
  async function publish(kind: 'workout' | 'badge', badgeId?: BadgeId) {
    const description = kind === 'workout' ? workoutDescription : badgeDescription;
    if (description.length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(description)) {
      setError('La descripción admite hasta 500 caracteres de texto.'); return;
    }
    const caption = description.trim() ? { description: description.trim() } : {};
    if (kind === 'workout' && completed.some(log => log.id === workoutId)) {
      if (await request({ type: 'shareWorkout', workoutId, ...caption }, 'Entrenamiento compartido y confirmado.')) setWorkoutDescription('');
    } else if (kind === 'badge' && badgeId && stats?.badges.some(b => b.id === badgeId && b.earned)) {
      if (await request({ type: 'shareBadge', badgeId, ...caption }, 'Insignia compartida.')) setBadgeDescription('');
    }
  }
  async function openWorkout(postId: string, returnFocus: HTMLElement | null) {
    if (!alive.current || busy.current) return;
    busy.current = true;
    const token = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    setPending(true); setError(''); setNotice('');
    try {
      const result = await boundedSocialRequest(() => detail(postId, abort.signal), abort);
      if (!alive.current || generation.current !== token || abort.signal.aborted) return;
      onViewWorkout(result, returnFocus);
    } catch (reason) {
      if (alive.current && generation.current === token) setError(reason instanceof ApiError ? reason.message : 'No pudimos abrir el entrenamiento compartido. Actualiza e inténtalo de nuevo.');
    } finally {
      if (alive.current && generation.current === token) { busy.current = false; setPending(false); }
    }
  }
  async function createGoal(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    const amount = Number(target);
    if (!title.trim() || title.trim().length > 80 || /[\x00-\x1f]/.test(title) || !Number.isInteger(amount) || amount < 1 || amount > 100 || !validDate(startDate) || !validDate(endDate) || endDate < startDate) {
      setError('Completa un título de 1 a 80 caracteres, entre 1 y 100 entrenamientos y fechas válidas en orden.'); return;
    }
    const today = Date.parse(new Date().toISOString().slice(0, 10));
    if (Date.parse(endDate) - Date.parse(startDate) > 89 * 86400000 || Date.parse(startDate) < today - 366 * 86400000 || Date.parse(endDate) > today + 366 * 86400000) {
      setError('La meta puede abarcar hasta 90 días, con fechas dentro de un año antes o después de hoy.'); return;
    }
    if (await request({ type: 'createGoal', title: title.trim(), target: amount, startDate, endDate, shared }, 'Meta creada. El progreso se calcula en el servidor.')) {
      setTitle(''); setShared(false);
    }
  }
  const incoming = data?.invitations.filter(item => item.direction === 'incoming') ?? [];
  const completed = logs.filter(log => log.completed && log.id && !Number.isNaN(Date.parse(log.date)));
  const stats = data?.me.stats;
  const nextBadge = stats?.badges.filter(badge => !badge.earned).sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  const own = (email: string) => email.toLowerCase() === user.email.toLowerCase();
  const button = 'friends-view__button';

  return <div className="friends-view">
    <header className="friends-view__hero">
      <div><span className="friends-view__eyebrow"><Users size={15} aria-hidden="true" /> TU CÍRCULO KYON</span>
        <h1>Entrena mejor,<br /><span>en compañía.</span></h1>
        <p>Pequeños logros. Apoyo real. Cada quien a su ritmo.</p>
      </div>
      <div className="friends-view__hero-mark" aria-hidden="true"><Users size={54} /><Sparkles size={24} /></div>
      <button className={button} disabled={pending} onClick={() => void request()}><RefreshCw size={16} aria-hidden="true" />{pending ? 'Actualizando…' : 'Actualizar'}</button>
    </header>
    <div className="friends-view__status" role="status" aria-live="polite">{pending ? (data ? 'Esperando confirmación del servidor…' : 'Cargando tu comunidad…') : notice}</div>
    {error && <div className="friends-view__error" role="alert"><p>{error}</p><button className={button} disabled={pending} onClick={() => void request()}>Reintentar carga</button></div>}
    {!data && !pending && !error && <p>No hay información disponible. Actualiza para volver a cargar.</p>}
    {data && <>
      <section className="friends-view__stats" aria-label="Tu progreso personal">
        <div><strong>{stats?.completedWorkouts ?? '—'}</strong><span>Entrenamientos completados</span></div>
        <div><strong>{stats?.currentWeeklyStreak ?? '—'} <small>semanas</small></strong><span>Constancia semanal</span></div>
        <div><strong>{stats ? stats.badges.filter(badge => badge.earned).length : '—'}</strong><span>Insignias ganadas</span></div>
      </section>
      <p className="friends-view__rest">La constancia se mide por semanas, no por entrenar todos los días. Descansar también cuenta como cuidarte.</p>
      {nextBadge && <section className="friends-view__next" aria-label="Tu próximo hito"><Award size={23} aria-hidden="true" /><div><span>TU PRÓXIMO HITO</span><strong>{nextBadge.title}</strong><small>{nextBadge.progress} de {nextBadge.target}. A tu ritmo, cada sesión suma.</small></div><button className={button} onClick={() => setTab('Insignias')}>Ver mis insignias <ArrowUpRight size={16} aria-hidden="true" /></button></section>}
      <nav className="friends-view__tabs" aria-label="Secciones de amigos">{tabs.map(item => <button key={item} className={button} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}{item === 'Amigos' && incoming.length > 0 && <span className="friends-view__count" aria-label={`${incoming.length} solicitudes pendientes`}>{incoming.length}</span>}</button>)}</nav>

      <section className="friends-view__card friends-view__requests" aria-label="Solicitudes de amistad">
        <div className="friends-view__heading"><h2>Solicitudes <span className="friends-view__count">{incoming.length}</span></h2><span className="friends-view__subtle">Siempre a mano</span></div>
        {data.invitations.length === 0 ? <p>No tienes solicitudes pendientes.</p> : <ul className="friends-view__list">{data.invitations.map(item => <li key={item.id}>
          <div><strong>{item.direction === 'incoming' ? item.from.name : item.toEmail}</strong><p>{item.direction === 'incoming' ? item.from.email : 'Solicitud enviada en Kyon · pendiente de aceptación'}</p>
            <small>Solicitud dentro de la app. No se envían correos.</small></div>
          <div className="friends-view__actions">{item.direction === 'incoming' ? <><button className={`${button} friends-view__button--primary`} disabled={pending} onClick={() => void request({ type: 'accept', invitationId: item.id }, 'Solicitud aceptada por el servidor.')}>Aceptar</button><button className={button} disabled={pending} onClick={() => void request({ type: 'decline', invitationId: item.id }, 'Solicitud rechazada.')}>Rechazar</button></> : <button className={button} disabled={pending} onClick={() => void request({ type: 'cancel', invitationId: item.id }, 'Solicitud cancelada.')}>Cancelar solicitud</button>}</div>
        </li>)}</ul>}
      </section>

      {tab === 'Amigos' && <div className="friends-view__columns">
        <section className="friends-view__card"><h2>Invita a tu círculo</h2><p>Conecta por correo. La otra persona debe aceptar antes de ser tu amiga.</p>
          <form className="friends-view__form" onSubmit={invite} noValidate>
            <label htmlFor={`${id}-email`}>Correo de tu amigo o amiga</label>
            <input id={`${id}-email`} name="inviteEmail" type="email" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={people.length > 0 && !selectedPerson} aria-controls={`${id}-people`} aria-activedescendant={people.length && !selectedPerson ? `${id}-person-${highlighted}` : undefined} aria-describedby={`${id}-search-notice`} maxLength={254} value={email} disabled={pending} onChange={event => { setEmail(event.target.value); setSelectedPerson(null); }} onKeyDown={event => {
              if (!people.length || selectedPerson) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlighted(i => (i + (event.key === 'ArrowDown' ? 1 : people.length - 1)) % people.length); }
              if (event.key === 'Enter') { event.preventDefault(); const person = people[highlighted]; setSelectedPerson(person); setEmail(person.email); }
              if (event.key === 'Escape') { event.preventDefault(); setPeople([]); }
            }} placeholder="nombre@ejemplo.com" required />
            <div id={`${id}-people`} role="listbox" aria-label="Cuentas encontradas">{!selectedPerson && people.map((person, index) => <button id={`${id}-person-${index}`} key={person.email} type="button" role="option" aria-selected={highlighted === index} className="friends-view__person-option" disabled={pending} onClick={() => { setSelectedPerson(person); setEmail(person.email); }}><Users size={18} aria-hidden="true" /><span><strong>{person.name}</strong><small>{person.email}</small></span><Check size={16} aria-hidden="true" /></button>)}</div>
            <p id={`${id}-search-notice`} role="status">{selectedPerson ? `Cuenta seleccionada: ${selectedPerson.name} (${selectedPerson.email})` : searching ? 'Buscando cuenta…' : searchNotice}</p>
            <button className={`${button} friends-view__button--primary`} disabled={pending || !selectedPerson || searching}>Enviar solicitud <ArrowUpRight size={16} aria-hidden="true" /></button>
            <small>El correo identifica la cuenta. La invitación se recibe únicamente dentro de Kyon.</small>
          </form>
        </section>
        <section className="friends-view__card"><h2>Tu privacidad, tu decisión</h2><p>{data.me.sharing ? 'Compartes estadísticas resumidas con tus amigos.' : 'Tus estadísticas son privadas.'} Tu historial no se publica automáticamente. Si compartes un entrenamiento, tus amigos podrán ver sus ejercicios, series, pesos y repeticiones. Las publicaciones y metas se comparten por separado.</p>
          <button className={button} disabled={pending} aria-pressed={data.me.sharing} onClick={() => void request({ type: 'setSharing', sharing: !data.me.sharing }, 'Preferencia de privacidad confirmada.')}><LockKeyhole size={16} aria-hidden="true" />{data.me.sharing ? 'Dejar de compartir estadísticas' : 'Compartir estadísticas con amigos'}</button>
        </section>
        <section className="friends-view__card friends-view__wide"><h2>Amigos · {data.friends.length}</h2>{!data.friends.length ? <p>Tu círculo empieza aquí. Invita a alguien con quien te guste entrenar.</p> : <ul className="friends-view__list">{data.friends.map(friend => <li key={friend.email}>
          <div><strong>{friend.name}</strong><p>{friend.email}</p>{friend.sharing && friend.stats !== null ? <>
            <small>{friend.stats.completedWorkouts} entrenamientos · {friend.stats.currentWeeklyStreak} semanas de constancia · {friend.stats.badges.filter(badge => badge.earned).length} insignias</small>
            <div className="friends-view__friend-badges" aria-label={`Insignias de ${friend.name}`}>{friend.stats.badges.filter(badge => badge.earned).map(badge => <span key={badge.id} title={badge.description}><Award size={14} aria-hidden="true" />{badge.title}</span>)}</div>
          </> : <small>Estadísticas privadas</small>}</div>
          <div className="friends-view__actions">{removeEmail === friend.email ? <><span>¿Quitar a {friend.name} de tus amigos?</span><button className={button} disabled={pending} onClick={() => { void request({ type: 'removeFriend', email: friend.email }, 'Amistad eliminada.').then(ok => { if (ok) setRemoveEmail(null); }); }}>Sí, quitar amistad</button><button className={button} disabled={pending} onClick={() => setRemoveEmail(null)}>Conservar amistad</button></> : <button className={button} disabled={pending} onClick={() => setRemoveEmail(friend.email)}>Quitar amistad</button>}</div>
        </li>)}</ul>}</section>
      </div>}

      {tab === 'Comunidad' && <div className="friends-view__columns">
        <section className="friends-view__card friends-view__share"><span className="friends-view__eyebrow">UN PASO QUE MERECE CELEBRARSE</span><h2>Comparte un entrenamiento</h2><p>Solo entrenamientos completados. Se comparte solo si ya está sincronizado; el servidor lo comprueba.</p>
          <div className="friends-view__form"><label htmlFor={`${id}-workout`}>Entrenamiento completado</label><select id={`${id}-workout`} value={workoutId} disabled={pending || !completed.length} onChange={event => setWorkoutId(event.target.value)}><option value="">Selecciona un entrenamiento</option>{completed.map(log => <option key={log.id} value={log.id}>{log.title} · {dateLabel(log.date)}</option>)}</select>
            <label htmlFor={`${id}-workout-description`}>Descripción de la publicación (opcional)</label><textarea className="friends-view__publication-description" id={`${id}-workout-description`} name="workoutDescription" rows={3} maxLength={500} value={workoutDescription} disabled={pending} onChange={event => setWorkoutDescription(event.target.value)} placeholder="¿Cómo te fue? Comparte tu avance…" aria-describedby={`${id}-workout-sharing`} /><small>{workoutDescription.length}/500 caracteres</small>
            <p id={`${id}-workout-sharing`}>Al publicar, tus amigos podrán abrir el registro completo de este entrenamiento: ejercicios, series, pesos y repeticiones. No se comparte el resto de tu historial.</p>
            <button className={`${button} friends-view__button--primary`} disabled={pending || !completed.some(log => log.id === workoutId)} onClick={() => void publish('workout')}>Compartir entrenamiento</button>{!completed.length && <p>Aún no tienes entrenamientos completados para compartir.</p>}
          </div>
        </section>
        <section className="friends-view__feed" aria-label="Actividad compartida"><div className="friends-view__heading"><h2>Lo que nos mueve</h2><span className="friends-view__subtle">Actividad compartida</span></div>{!data.posts.length ? <div className="friends-view__card friends-view__empty"><Heart size={28} aria-hidden="true" /><h3>El próximo logro puede ser el tuyo</h3><p>Aún no hay actividad compartida. Aquí verás entrenamientos e insignias que tu círculo elija publicar.</p></div> : data.posts.slice(0, 30).map(post => {
          const content = <><span className="friends-view__heading"><strong>{post.owner.name}</strong><time dateTime={post.createdAt}>{dateLabel(post.createdAt)}</time></span><span className="friends-view__tag">{post.kind === 'badge' ? 'Insignia ganada' : 'Entrenamiento completado'}</span><span className="friends-view__post-title" role="heading" aria-level={3}>{post.title}</span><span className="friends-view__post-summary">{post.detail}</span>{post.description && <span className="friends-view__post-description">{post.description}</span>}{post.hasWorkoutDetails && <span className="friends-view__post-link">Ver registro completo <ArrowUpRight size={15} aria-hidden="true" /></span>}</>;
          return <article className="friends-view__card friends-view__post" key={post.id}>
            {post.kind === 'workout' && post.hasWorkoutDetails ? <button className="friends-view__post-open" type="button" disabled={pending} onClick={event => void openWorkout(post.id, event.currentTarget)} aria-label={`Ver entrenamiento compartido de ${post.owner.name}: ${post.title}`}>{content}</button> : <div>{content}{post.kind === 'workout' && <p>Esta publicación antigua no incluye el detalle. Su autor puede eliminarla y volver a compartirla.</p>}</div>}
            <div className="friends-view__actions"><button className={button} disabled={pending || post.cheered} aria-pressed={post.cheered} onClick={() => void request({ type: 'cheer', postId: post.id }, 'Ánimo confirmado por el servidor.')}><Heart size={16} aria-hidden="true" />{post.cheered ? 'Ánimo enviado' : 'Ánimo'} · {post.cheers}</button>{own(post.owner.email) && <button className={button} disabled={pending} onClick={() => void request({ type: 'deletePost', postId: post.id }, 'Publicación eliminada.')}>Eliminar publicación</button>}</div>
          </article>;
        })}{data.posts.length > 30 && <p>Se muestran las 30 publicaciones más recientes recibidas.</p>}</section>
      </div>}

      {tab === 'Insignias' && <section aria-label="Tus insignias"><div className="friends-view__section-heading"><h2>Celebra el camino, no la prisa</h2><p>Logros calculados por Kyon a partir de entrenamientos sincronizados. Las rachas son semanales y dejan espacio para descansar.</p></div><div className="friends-view__card friends-view__badge-composer friends-view__form"><label htmlFor={`${id}-badge-description`}>Descripción para compartir una insignia (opcional)</label><textarea className="friends-view__publication-description" id={`${id}-badge-description`} name="badgeDescription" rows={3} maxLength={500} value={badgeDescription} disabled={pending} onChange={event => setBadgeDescription(event.target.value)} placeholder="Cuenta lo que significa este logro para ti…" /><small>{badgeDescription.length}/500 caracteres. Se añadirá a la siguiente insignia que compartas.</small></div>{!stats?.badges.length ? <p>No hay información de insignias disponible todavía.</p> : <div className="friends-view__badge-grid">{stats.badges.map(badge => {
        const BadgeIcon = badge.id.startsWith('streak-') ? Flame : badge.id.startsWith('workouts-') ? Dumbbell : badge.id === 'personal-best' ? TrendingUp : Award;
        return <article className={`friends-view__card friends-view__badge ${badge.earned ? 'friends-view__badge--earned' : ''}`} key={badge.id}><div className="friends-view__badge-icon"><BadgeIcon size={30} aria-hidden="true" /></div><span className="friends-view__tag">{badge.earned ? 'Ganada' : 'Por desbloquear'}</span><h3>{badge.title}</h3><p>{badge.description}</p><progress aria-label={`Progreso de ${badge.title}`} max={Math.max(1, badge.target)} value={Math.min(Math.max(0, badge.progress), Math.max(1, badge.target))} /><small>{badge.progress} / {badge.target} · {badge.earned ? '¡Un logro tuyo!' : `Próximo objetivo: ${badge.target}`}</small><button className={button} disabled={pending || !badge.earned} onClick={() => void publish('badge', badge.id)}>{badge.earned ? <Check size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}Compartir insignia<span className="friends-view__sr-only">: {badge.title}</span></button></article>;
      })}</div>}</section>}

      {tab === 'Metas' && <div className="friends-view__columns"><section className="friends-view__card"><h2>Una meta a tu medida</h2><p>Cuenta entrenamientos completados entre dos fechas. Privada por defecto, sin competir con nadie.</p><form className="friends-view__form" noValidate onSubmit={createGoal}><label htmlFor={`${id}-title`}>Nombre de la meta</label><input id={`${id}-title`} name="goalTitle" maxLength={80} value={title} onChange={event => setTitle(event.target.value)} disabled={pending} required /><label htmlFor={`${id}-target`}>Entrenamientos objetivo (1–100)</label><input id={`${id}-target`} name="goalTarget" type="number" min={1} max={100} step={1} value={target} onChange={event => setTarget(event.target.value)} disabled={pending} required /><label htmlFor={`${id}-start`}>Fecha de inicio</label><input id={`${id}-start`} name="goalStart" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} disabled={pending} required /><label htmlFor={`${id}-end`}>Fecha de fin</label><input id={`${id}-end`} name="goalEnd" type="date" value={endDate} onChange={event => setEndDate(event.target.value)} disabled={pending} required /><label className="friends-view__checkbox"><input name="goalShared" type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} disabled={pending} />Compartir esta meta con mis amigos</label><button className={`${button} friends-view__button--primary`} disabled={pending}>Crear meta</button></form></section><section aria-label="Metas personales y de amigos"><div className="friends-view__section-heading"><h2>Un paso a la vez</h2><p>El progreso lo confirma el servidor; las metas de amigos son solo de lectura.</p></div>{!data.goals.length ? <div className="friends-view__card"><p>Aún no hay metas. Elige un objetivo que encaje con tu vida.</p></div> : data.goals.map(goal => <article className="friends-view__card friends-view__goal" key={goal.id}><span className="friends-view__tag">{own(goal.owner.email) ? (goal.shared ? 'Tu meta · compartida' : 'Tu meta · privada') : `Meta de ${goal.owner.name}`}</span><h3>{goal.title}</h3><p>{dateLabel(goal.startDate)} — {dateLabel(goal.endDate)}</p><progress aria-label={`Progreso de ${goal.title}`} max={Math.max(1, goal.target)} value={Math.min(Math.max(0, goal.progress), Math.max(1, goal.target))} /><p><strong>{goal.progress} / {goal.target}</strong> entrenamientos completados</p>{own(goal.owner.email) && <button className={button} disabled={pending} onClick={() => void request({ type: 'deleteGoal', goalId: goal.id }, 'Meta eliminada.')}>Eliminar meta</button>}</article>)}</section></div>}
    </>}
  </div>;
}
