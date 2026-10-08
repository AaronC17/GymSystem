import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AccessInfo, AuthUser, Unit } from '../types';
import './ProfileView.css';

export type ProfileProps = {
  user: AuthUser;
  access: AccessInfo;
  unit: Unit;
  onSetUnit: (unit: Unit) => void;
  onCheckAccess: () => Promise<boolean>;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onNotify?: (message: string) => void;
};

export function validateProfilePassword(current: string, next: string, confirmation: string): string | null {
  if (!current || current.length > 256) return 'Ingresa tu contraseña actual (máximo 256 caracteres).';
  if (next.length < 8 || next.length > 128 || !/\p{L}/u.test(next) || !/\d/u.test(next)) {
    return 'La nueva contraseña debe tener entre 8 y 128 caracteres, al menos una letra y un número.';
  }
  if (next !== confirmation) return 'Las contraseñas nuevas no coinciden.';
  return null;
}

export function ProfileView({ user, access, unit, onSetUnit, onCheckAccess, onChangePassword, onNotify }: ProfileProps) {
  const id = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordNotice, setPasswordNotice] = useState('');
  const [accessNotice, setAccessNotice] = useState('');
  const passwordPending = useRef(false);
  const accessPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const active = access.status === 'active';
  const trialDate = access.trialEndsAt ? new Date(access.trialEndsAt) : null;
  const formattedDate = trialDate && Number.isFinite(trialDate.getTime())
    ? trialDate.toLocaleDateString('es-CR', { year: 'numeric', month: 'long', day: 'numeric' }) : null;
  const whatsapp = `https://wa.me/50661555619?text=${encodeURIComponent(`Hola, quiero comprar el acceso permanente a Kyon+ para ${user.email}. Precio: ₡5.000, pago único por SINPE. ¿Me compartes los datos para realizar el pago? Entiendo que la activación es MANUAL desde Admin después de verificarlo.`)}`;

  function notify(message: string) {
    // A notification failure must not turn a successful server operation into an error.
    try { onNotify?.(message); } catch { /* Notification is optional. */ }
  }

  async function checkAccess() {
    if (accessPending.current) return;
    accessPending.current = true;
    setChecking(true);
    setAccessNotice('');
    try {
      const confirmed = await onCheckAccess();
      if (!mounted.current) return;
      const message = confirmed ? 'El servidor confirmó tu acceso activo.' : 'Tu acceso aún no está activo. La activación es manual después de verificar el pago.';
      setAccessNotice(message);
      notify(message);
    } catch {
      if (mounted.current) setAccessNotice('No fue posible comprobar el acceso. Intenta de nuevo.');
    } finally {
      accessPending.current = false;
      if (mounted.current) setChecking(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordPending.current) return;
    setPasswordNotice('');
    const error = validateProfilePassword(current, next, confirmation);
    setPasswordError(error ?? '');
    if (error) return;
    passwordPending.current = true;
    setSaving(true);
    try {
      await onChangePassword(current, next);
      if (!mounted.current) return;
      setCurrent('');
      setNext('');
      setConfirmation('');
      setVisible(false);
      const message = 'Contraseña actualizada. Inicia sesión de nuevo.';
      setPasswordNotice(message);
      notify(message);
    } catch {
      if (mounted.current) setPasswordError('No fue posible cambiar la contraseña. Verifica tu contraseña actual e intenta de nuevo.');
    } finally {
      passwordPending.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return <div className="profile-view">
    <header className="profile-view__header">
      <span className="profile-view__eyebrow">TU CUENTA KYON</span>
      <h1>Perfil</h1>
      <p>Tu acceso, tus preferencias y la seguridad de tu cuenta.</p>
    </header>
    <div className="profile-view__grid">
      <section className="profile-view__card" aria-labelledby={`${id}-identity`}>
        <h2 id={`${id}-identity`}>Información personal</h2>
        <p>Los datos con los que creaste tu cuenta.</p>
        <dl className="profile-view__identity">
          <div><dt>Nombre</dt><dd>{user.name}</dd></div>
          <div><dt>Correo electrónico</dt><dd>{user.email}</dd></div>
        </dl>
      </section>

      <section className="profile-view__card" aria-labelledby={`${id}-access`}>
        <div className="profile-view__card-heading"><h2 id={`${id}-access`}>Estado de acceso</h2>
          <span className={`profile-view__badge${active ? ' profile-view__badge--active' : ''}`}>{active ? 'Activo' : access.status === 'trial' ? 'Prueba gratis' : 'Prueba finalizada'}</span>
        </div>
        {active ? <p>Acceso permanente. Sin pagos recurrentes.</p> : <>
          <p>{access.status === 'trial' ? `${access.trialDaysRemaining} ${access.trialDaysRemaining === 1 ? 'día restante' : 'días restantes'} de prueba.` : 'Tu período de prueba ha terminado.'}</p>
          {formattedDate && <p>Fin de la prueba: <time dateTime={access.trialEndsAt!}>{formattedDate}</time>.</p>}
          <div className="profile-view__purchase">
            <h3>{access.status === 'trial' ? 'Compra anticipada' : 'Continúa con Kyon'}</h3>
            <strong className="profile-view__price">₡5.000 <span>pago único</span></strong>
            <p>Coordina el SINPE y envía tu comprobante por WhatsApp. La activación es manual desde Admin después de verificar el pago.</p>
            <a className="profile-view__button profile-view__button--primary" href={whatsapp} target="_blank" rel="noopener noreferrer">Comprar por WhatsApp <span className="profile-view__sr-only">(abre una pestaña nueva)</span></a>
            <button className="profile-view__button" type="button" onClick={() => void checkAccess()} disabled={checking} aria-describedby={`${id}-access-notice`}>{checking ? 'Comprobando…' : 'Comprobar activación'}</button>
          </div>
        </>}
        <p id={`${id}-access-notice`} className="profile-view__notice" role="status" aria-live="polite">{accessNotice}</p>
      </section>

      <section className="profile-view__card" aria-labelledby={`${id}-settings`}>
        <h2 id={`${id}-settings`}>Configuración</h2>
        <p>Elige tu unidad de peso para registrar entrenamientos.</p>
        {access.status === 'expired' && <p>Activa tu acceso para cambiar las preferencias de entrenamiento. Puedes administrar la contraseña de tu cuenta.</p>}
        <div className="profile-view__units" role="group" aria-label="Unidad de peso">
          {(['kg', 'lb'] as const).map((value) => <button className="profile-view__button" key={value} type="button" disabled={access.status === 'expired'} aria-pressed={unit === value} onClick={() => onSetUnit(value)}>{value === 'kg' ? 'Kilogramos (kg)' : 'Libras (lb)'}</button>)}
        </div>
      </section>

      <section className="profile-view__card" aria-labelledby={`${id}-security`}>
        <h2 id={`${id}-security`}>Cambiar contraseña</h2>
        <p>Después del cambio tendrás que iniciar sesión de nuevo.</p>
        <form onSubmit={(event) => void changePassword(event)} noValidate aria-busy={saving}>
          <div className="profile-view__fields">
            <label htmlFor={`${id}-current`}>Contraseña actual</label>
            <input id={`${id}-current`} name="currentPassword" type={visible ? 'text' : 'password'} autoComplete="current-password" maxLength={256} required value={current} disabled={saving} onChange={(event) => setCurrent(event.target.value)} aria-describedby={`${id}-password-error`} aria-invalid={passwordError ? true : undefined} />
            <label htmlFor={`${id}-new`}>Nueva contraseña</label>
            <input id={`${id}-new`} name="newPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} required value={next} disabled={saving} onChange={(event) => setNext(event.target.value)} aria-describedby={`${id}-password-help ${id}-password-error`} aria-invalid={passwordError ? true : undefined} />
            <p id={`${id}-password-help`}>Entre 8 y 128 caracteres, al menos una letra y un número.</p>
            <label htmlFor={`${id}-confirm`}>Confirmar nueva contraseña</label>
            <input id={`${id}-confirm`} name="confirmPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128} required value={confirmation} disabled={saving} onChange={(event) => setConfirmation(event.target.value)} aria-describedby={`${id}-password-error`} aria-invalid={passwordError ? true : undefined} />
          </div>
          <button className="profile-view__visibility" type="button" aria-pressed={visible} aria-controls={`${id}-current ${id}-new ${id}-confirm`} disabled={saving} onClick={() => setVisible(!visible)}>{visible ? 'Ocultar contraseñas' : 'Mostrar contraseñas'}</button>
          <p id={`${id}-password-error`} className="profile-view__error" role="alert">{passwordError}</p>
          <p className="profile-view__notice" role="status" aria-live="polite">{passwordNotice}</p>
          <button className="profile-view__button profile-view__button--primary" type="submit" disabled={saving}>{saving ? 'Actualizando…' : 'Actualizar contraseña'}</button>
        </form>
      </section>
    </div>
  </div>;
}

export default ProfileView;
