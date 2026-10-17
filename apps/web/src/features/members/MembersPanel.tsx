import { UserPlusIcon } from '@phosphor-icons/react';
import { Avatar } from '../../components/ui/Avatar';
import { buttonClass } from '../../components/ui/Button';
import { cardClass } from '../../components/ui/Card';
import { LockSimpleIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import type { Role } from 'contracts';
import { useState, type FormEvent } from 'react';
import { ErrorMessage } from '../../components/ErrorMessage';
import { inputClass } from '../../components/Field';
import { api } from '../../lib/apiClient';
import { useCurrentUser } from '../auth/AuthProvider';
import type { LiveMember, LiveTrip } from '../trips/useTrip';

const ROLE_LABEL: Record<Role, string> = { creator: 'Creador', admin: 'Admin', member: 'Participante' };
const INVITATION_LABEL = { invited: 'Invitación pendiente', declined: 'Rechazó la invitación', accepted: 'Aceptó' } as const;

export function MembersPanel({ trip, members, myRole }: { trip: LiveTrip; members: LiveMember[]; myRole: Role }) {
  const { user } = useCurrentUser();
  const [emails, setEmails] = useState('');
  const isCreator = myRole === 'creator';
  const mutable = trip.status === 'pending' || trip.status === 'active';
  const canManageInvites = isCreator && mutable && !trip.participantsLocked;

  const invite = useMutation({
    mutationFn: (list: string[]) =>
      api('POST', `/trips/${trip.id}/invitations`, { body: { expectedVersion: trip.version, emails: list } }),
    onSuccess: () => setEmails(''),
  });
  const setRole = useMutation({
    mutationFn: ({ uid, role }: { uid: string; role: 'admin' | 'member' }) =>
      api('PUT', `/trips/${trip.id}/members/${uid}/role`, { body: { expectedVersion: trip.version, role } }),
  });
  const remove = useMutation({
    mutationFn: (memberKey: string) =>
      api('DELETE', `/trips/${trip.id}/invitations/${memberKey}`, { query: { expectedVersion: trip.version } }),
  });

  function onInvite(e: FormEvent) {
    e.preventDefault();
    const list = emails.split(/[\s,;]+/).filter(Boolean);
    if (list.length > 0) invite.mutate(list);
  }

  return (
    <section aria-labelledby="members-title" className="space-y-3">
      <h2 id="members-title" className="text-lg font-semibold tracking-tight">
        Participantes
      </h2>
      <ul className={`${cardClass} divide-y divide-slate-100`}>
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Avatar name={m.displayName ?? m.email} seed={m.uid ?? m.email} />
              <div className="min-w-0">
              <p className="font-medium">
                {m.displayName ?? m.email}
                {m.uid === user.uid && <span className="text-slate-500"> (tú)</span>}
              </p>
              <p className="text-sm text-slate-600">
                {m.invitationStatus === 'accepted' ? ROLE_LABEL[m.role] : INVITATION_LABEL[m.invitationStatus]}
                {m.displayName && m.invitationStatus === 'accepted' && !m.deletedAt ? ` · ${m.email}` : ''}
                {m.deletedAt ? ' · Cuenta eliminada' : ''}
              </p>
              </div>
            </div>
            <div className="flex gap-2" data-member-actions={m.id}>
              {isCreator && mutable && m.invitationStatus === 'accepted' && m.role !== 'creator' && m.uid && !m.deletedAt && (
                <button
                  type="button"
                  disabled={setRole.isPending}
                  onClick={() => setRole.mutate({ uid: m.uid!, role: m.role === 'admin' ? 'member' : 'admin' })}
                  className={buttonClass('secondary', 'sm')}
                  aria-label={`${m.role === 'admin' ? 'Quitar admin a' : 'Hacer admin a'} ${m.displayName ?? m.email}`}
                >
                  {m.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
                </button>
              )}
              {canManageInvites && m.invitationStatus !== 'accepted' && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(m.id)}
                  className={buttonClass('secondary', 'sm')}
                  aria-label={`Retirar invitación de ${m.email}`}
                >
                  Retirar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ErrorMessage error={remove.error ?? setRole.error} />
      {canManageInvites && (
        <form onSubmit={onInvite} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="invite-emails" className="sr-only">
            Correos a invitar
          </label>
          <input
            id="invite-emails"
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="correo@ejemplo.com"
            className={inputClass}
          />
          <button type="submit" disabled={invite.isPending} className={buttonClass('primary', 'md', 'shrink-0')}>
            <UserPlusIcon size={18} />
            Invitar
          </button>
        </form>
      )}
      <ErrorMessage error={invite.error} />
      {trip.participantsLocked && (
        <p className="flex items-center gap-1.5 text-sm text-slate-600"><LockSimpleIcon className="shrink-0" />Los participantes quedaron fijos al registrar el primer gasto.</p>
      )}
    </section>
  );
}
