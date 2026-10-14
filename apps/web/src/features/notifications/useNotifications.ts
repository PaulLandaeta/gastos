import { useMutation } from '@tanstack/react-query';
import type { NotificationsReadBody, NotificationType } from 'contracts';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { api } from '../../lib/apiClient';
import { db } from '../../lib/firebase';
import { useCurrentUser } from '../auth/AuthProvider';

export interface InboxItem {
  id: string;
  type: NotificationType;
  tripId: string;
  tripName: string;
  title: string;
  body: string | null;
  link: string;
  createdAt: Date;
  readAt: Date | null;
}

const PAGE = 50;
const UNREAD_CAP = 100;

const toDate = (v: unknown) => (v && typeof v === 'object' && 'toDate' in v ? (v as { toDate: () => Date }).toDate() : null);

/** Live inbox (RF-18): the 50 most recent, plus an unread counter capped at 99+. Rules: owner only. */
export function useNotifications() {
  const { user } = useCurrentUser();
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    const col = collection(db, `users/${user.uid}/notifications`);
    const stopList = onSnapshot(
      query(col, orderBy('createdAt', 'desc'), limit(PAGE)),
      (snap) =>
        setItems(
          snap.docs.map((d) => {
            const data = d.data();
            return { ...(data as InboxItem), id: d.id, createdAt: toDate(data['createdAt']) ?? new Date(0), readAt: toDate(data['readAt']) };
          }),
        ),
      () => setItems([]),
    );
    const stopUnread = onSnapshot(
      query(col, where('readAt', '==', null), limit(UNREAD_CAP)),
      (snap) => setUnread(snap.size),
      () => setUnread(0),
    );
    return () => {
      stopList();
      stopUnread();
    };
  }, [user.uid]);

  return { items, unread, loading: items === null };
}

export function useMarkNotifications() {
  return useMutation({
    mutationFn: ({ read, target }: { read: boolean; target: NotificationsReadBody }) =>
      api<{ updated: number }>('POST', `/me/notifications/${read ? 'read' : 'unread'}`, { body: target }),
  });
}

export const unreadLabel = (n: number) => (n >= UNREAD_CAP ? '99+' : String(n));
