import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Award, Check, LockKeyhole, Sparkles, X } from 'lucide-react';
import { KYO_BADGES, getKyoBadge } from '../badgeCatalog';
import type { BadgeId, SocialBadge } from '../socialTypes';
import { activateDialogFocus } from '../dialogFocus';

export function BadgeArtwork({ id, className = '' }: { id: BadgeId; className?: string }) {
  const definition = getKyoBadge(id);
  return definition
    ? <img className={`kyo-badge-art ${className}`} src={definition.artwork} width="256" height="256" alt="" draggable={false} />
    : <Award className={`kyo-badge-art ${className}`} aria-hidden="true" />;
}

export const collectionBadges = (badges: SocialBadge[] = []) => KYO_BADGES.flatMap(definition => {
  const badge = badges.find(item => item.id === definition.id);
  return badge ? [badge] : [];
});

function BadgeDetail({ badge, returnFocus, onClose }: { badge: SocialBadge; returnFocus: HTMLElement; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const definition = getKyoBadge(badge.id)!;
  useLayoutEffect(() => {
    if (!dialog.current) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const release = activateDialogFocus(dialog.current, {
      returnFocus, onEscape: () => close.current(),
      backgroundElements: document.querySelectorAll('.app-shell'),
    });
    return () => { document.body.style.overflow = overflow; release(); };
  }, [returnFocus]);

  return createPortal(<div className="friends-view friends-view--lightbox" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={`kyo-badge-detail ${badge.earned ? 'kyo-badge-detail--earned' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-rule`} tabIndex={-1} style={{ '--badge-accent': definition.accent } as CSSProperties}>
      <button className="kyo-badge-detail__close" type="button" aria-label="Cerrar detalle de insignia" onClick={onClose}><X size={20} /></button>
      <span className="friends-view__eyebrow">COLECCIÓN KYO / {definition.chapter}</span>
      <div className="kyo-badge-detail__stage"><div className="kyo-badge-detail__halo" aria-hidden="true" /><BadgeArtwork id={badge.id} />
        {badge.earned && <div className="kyo-badge-detail__sparks" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} style={{ '--spark': index } as CSSProperties} />)}</div>}
      </div>
      <span className={`friends-view__badge-state ${badge.earned ? 'is-earned' : ''}`}>{badge.earned ? <Check size={13} /> : <LockKeyhole size={13} />}{badge.earned ? 'Es parte de tu historia' : 'Tu siguiente aventura'}</span>
      <h2 id={`${id}-title`}>{badge.title}</h2><p className="kyo-badge-detail__motto">{definition.motto}</p>
      <p id={`${id}-rule`}>{badge.description}</p>
      <progress aria-label={`Progreso de ${badge.title}`} max={badge.target} value={badge.progress} />
      <small>{badge.progress} / {badge.target} · {definition.requirement}</small>
      <button className="friends-view__button friends-view__button--primary" onClick={onClose}>Volver a mi colección <ArrowUpRight size={16} /></button>
    </div>
  </div>, document.body);
}

export function KyoBadgeCollection({ badges, pending, onShare, composer }: { badges: SocialBadge[]; pending: boolean; onShare: (id: BadgeId) => void; composer: ReactNode }) {
  const [selected, setSelected] = useState<{ id: BadgeId; trigger: HTMLElement } | null>(null);
  const items = collectionBadges(badges);
  const earned = items.filter(badge => badge.earned).length;
  const selectedBadge = items.find(badge => badge.id === selected?.id);

  return <section className="friends-view__collection" aria-label="Tus insignias">
    <div className="friends-view__collection-heading">
      <div><span className="friends-view__eyebrow"><Sparkles size={14} aria-hidden="true" /> COLECCIÓN 01 · KYO</span><h2>Tu esfuerzo tiene otra forma.</h2><p>Seis versiones de Kyo. Seis maneras de avanzar.<br />Cada una cuenta un capítulo de tu camino.</p></div>
      <div className="friends-view__collection-count"><strong>{earned}<span> / {KYO_BADGES.length}</span></strong><small>en tu colección</small></div>
    </div>
    <p className="friends-view__rest">Logros calculados a partir de entrenamientos sincronizados. Las rachas son semanales: hay espacio para descansar.</p>
    {!items.length ? <div className="friends-view__card"><p>No hay información de insignias disponible todavía.</p></div> : <div className="friends-view__badge-grid">{items.map((badge, index) => {
      const definition = getKyoBadge(badge.id)!;
      return <article className={`friends-view__card friends-view__badge ${badge.earned ? 'friends-view__badge--earned' : ''}`} key={badge.id} style={{ '--badge-accent': definition.accent, '--card-index': index } as CSSProperties}>
        <div className="friends-view__badge-edition"><span>{String(index + 1).padStart(2, '0')} / {definition.chapter}</span><span className={`friends-view__badge-state ${badge.earned ? 'is-earned' : ''}`}>{badge.earned ? <Check size={12} aria-hidden="true" /> : <LockKeyhole size={12} aria-hidden="true" />}{badge.earned ? 'Ganada' : 'Por descubrir'}</span></div>
        <button className="friends-view__badge-stage" type="button" onClick={event => setSelected({ id: badge.id, trigger: event.currentTarget })} aria-label={`Ver insignia: ${badge.title}`} aria-haspopup="dialog"><BadgeArtwork id={badge.id} /><span className="friends-view__badge-inspect"><ArrowUpRight size={15} aria-hidden="true" /></span></button>
        <div className="friends-view__badge-copy"><span className="friends-view__tag">{definition.requirement}</span><h3>{badge.title}</h3><p>{definition.motto}</p></div>
        <progress aria-label={`Progreso de ${badge.title}`} max={badge.target} value={badge.progress} />
        <small>{badge.progress} / {badge.target} · {badge.earned ? '¡Un logro tuyo!' : `Próximo objetivo: ${badge.target}`}</small>
        <button className="friends-view__button friends-view__badge-share" disabled={pending || !badge.earned} onClick={() => onShare(badge.id)}>{badge.earned ? <ArrowUpRight size={16} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}Compartir insignia<span className="friends-view__sr-only">: {badge.title}</span></button>
      </article>;
    })}</div>}
    {composer}
    {selected && selectedBadge && <BadgeDetail badge={selectedBadge} returnFocus={selected.trigger} onClose={() => setSelected(null)} />}
  </section>;
}
