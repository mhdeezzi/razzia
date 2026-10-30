// Compte connecté, partagé par toute l'app (barre du haut, page Compte, Suivi) : une seule écoute de la session Supabase.
import { useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

type AuthState = { ready: boolean; user: User | null; recovery: boolean };
let state: AuthState = { ready: !supabase, user: null, recovery: false };
const subs = new Set<(s: AuthState) => void>();
const set = (next: Partial<AuthState>) => {
  state = { ...state, ...next };
  subs.forEach((f) => f(state));
};

if (supabase) {
  void supabase.auth.getSession().then(({ data }) => set({ ready: true, user: data.session?.user ?? null }));
  supabase.auth.onAuthStateChange((event, session) => set({ ready: true, user: session?.user ?? null, ...(event === 'PASSWORD_RECOVERY' ? { recovery: true } : {}) }));
}

/** Utilisateur connecté (null sinon) ; ready passe à true une fois la session lue. recovery : arrivée par le lien « mot de passe oublié ». */
export function useAuth(): AuthState {
  const [s, setS] = useState(state);
  useEffect(() => {
    subs.add(setS);
    setS(state);
    return () => void subs.delete(setS);
  }, []);
  return s;
}

export const endRecovery = () => set({ recovery: false });
