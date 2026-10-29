// Compte (en ligne) : connexion par e-mail avec Supabase. Abonnement : page prête mais pas en ligne (VITE_BILLING=1),
// paiement pas encore branché ; les prix sont indicatifs, à valider avant l'ouverture.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';
import {
  AppleLogo, ArrowUpRight, Bell, CalendarCheck, ChartLineUp, Check, CreditCard, Crown, Envelope, GoogleLogo, Infinity as InfinityIcon,
  Lightning, LockKey, Receipt, Scales, ShieldCheck, SignOut, Sparkle, Star, UserCircle,
} from '@phosphor-icons/react';
import { Link, Segmented } from './ui.tsx';

// La page Abonnement n'est en ligne qu'avec VITE_BILLING=1 : sans elle, pas de lien vers les formules.
const PRICING = import.meta.env.VITE_BILLING === '1';

type Period = 'mois' | 'an';
interface Plan {
  id: string;
  name: string;
  pitch: string;
  monthly: number;
  yearly: number; // prix mensuel en formule annuelle
  cta: string;
  popular?: boolean;
  includes: Array<{ icon: ReactNode; text: string }>;
}

const PLANS: Plan[] = [
  {
    id: 'decouverte', name: 'Découverte', pitch: 'Pour suivre le programme et tester Razzia.', monthly: 0, yearly: 0, cta: 'Commencer',
    includes: [
      { icon: <CalendarCheck size={18} />, text: 'Programme NBA et ATP' },
      { icon: <Sparkle size={18} />, text: '3 simulations par jour' },
      { icon: <ShieldCheck size={18} />, text: 'Badges du jour' },
    ],
  },
  {
    id: 'pro', name: 'Razzia Pro', pitch: 'Tout ce qu’il faut pour suivre chaque soirée.', monthly: 9.99, yearly: 7.99, cta: 'Passer à Pro', popular: true,
    includes: [
      { icon: <InfinityIcon size={18} />, text: 'Simulations illimitées' },
      { icon: <Lightning size={18} />, text: 'Toute la soirée en un clic' },
      { icon: <Scales size={18} />, text: 'Handicaps et paris plus sûrs' },
      { icon: <ChartLineUp size={18} />, text: 'Comparateur de cotes et bilan complet' },
    ],
  },
  {
    id: 'elite', name: 'Razzia Elite', pitch: 'Pour tout voir avant tout le monde.', monthly: 24.99, yearly: 19.99, cta: 'Choisir Elite',
    includes: [
      { icon: <Check size={18} />, text: 'Tout Razzia Pro' },
      { icon: <Bell size={18} />, text: 'Alertes : compos, cotes qui bougent, chat noir' },
      { icon: <Star size={18} />, text: 'Nouveaux sports en avant-première' },
      { icon: <Crown size={18} />, text: 'Support prioritaire' },
    ],
  },
];

const euros = (v: number) => (v === 0 ? '0 €' : `${v.toFixed(2).replace('.', ',')} €`);

/** Formules d'abonnement : mensuel ou annuel (-20 %), trois cartes, la formule Pro mise en avant. */
export function PricingPage() {
  const [period, setPeriod] = useState<Period>('mois');
  return (
    <div className="page">
      <header className="page-head center">
        <span className="caps">Abonnement</span>
        <h1>Choisis ta formule</h1>
        <p className="lede">Sans engagement. Change ou arrête quand tu veux.</p>
      </header>
      <div className="pricing-switch">
        <Segmented<Period>
          ariaLabel="Facturation"
          value={period}
          onChange={setPeriod}
          options={[
            { value: 'mois', label: 'Mensuel' },
            { value: 'an', label: <>Annuel <span className="save">-20 %</span></> },
          ]}
        />
      </div>
      <div className="plans">
        {PLANS.map((p, i) => {
          const price = period === 'an' ? p.yearly : p.monthly;
          return (
            <article key={p.id} className={`plan${p.popular ? ' is-popular' : ''}`} style={{ '--i': i } as CSSProperties}>
              {p.popular && (
                <span className="plan-flag">
                  <Lightning size={13} weight="fill" /> Le plus choisi
                </span>
              )}
              <div className="plan-top">
                <h2>{p.name}</h2>
                <p className="plan-pitch">{p.pitch}</p>
                <p className="plan-price">
                  <b>{euros(price)}</b> <span>/ mois</span>
                </p>
                <p className="plan-bill">{price === 0 ? 'Gratuit, pour toujours' : period === 'an' ? `${euros(price * 12)} facturés par an` : 'Facturé chaque mois'}</p>
                <Link href="/compte" className={`btn glass btn-lg plan-cta${p.popular ? ' glass-brand' : ''}`}>
                  {p.cta}
                  {p.popular && <ArrowUpRight size={16} weight="bold" />}
                </Link>
              </div>
              <div className="plan-list">
                <span className="caps">{p.name} comprend</span>
                <ul>
                  {p.includes.map((f) => (
                    <li key={f.text}>
                      {f.icon}
                      {f.text}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>
      <p className="pay-row">
        <LockKey size={16} weight="bold" /> Paiement sécurisé
        <span className="pay-chip">
          <CreditCard size={16} /> Carte
        </span>
        <span className="pay-chip">
          <AppleLogo size={16} weight="fill" /> Apple Pay
        </span>
        <span className="pay-chip">
          <GoogleLogo size={16} weight="bold" /> Google Pay
        </span>
      </p>
      <p className="note center">Prix indicatifs, à valider avant l’ouverture des abonnements.</p>
    </div>
  );
}

type AuthMode = 'in' | 'up' | 'forgot' | 'reset';
const AUTH_FR: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou mot de passe incorrect.',
  'Email not confirmed': "Confirme d'abord ton e-mail (lien reçu par mail).",
  'User already registered': 'Un compte existe déjà avec cet e-mail.',
};
const authError = (m: string) => AUTH_FR[m] ?? m;

/** Compte : connexion, création, mot de passe oublié (Supabase), puis l'espace du compte. Pas encore de paiement. */
export function AccountPage() {
  const [mode, setMode] = useState<AuthMode>('in');
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  useEffect(() => {
    if (!supabase) return setReady(true);
    void supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === 'PASSWORD_RECOVERY') setMode('reset');
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(undefined);
    const back = `${location.origin}/compte`;
    const r =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : mode === 'up'
          ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: back } })
          : mode === 'forgot'
            ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: back })
            : await supabase.auth.updateUser({ password });
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: authError(r.error.message) });
    if (mode === 'up' && !('session' in r.data && r.data.session)) setMsg({ ok: true, text: 'Compte créé : clique sur le lien reçu par e-mail pour le confirmer.' });
    if (mode === 'forgot') setMsg({ ok: true, text: 'Si un compte existe, un lien pour changer le mot de passe vient de partir par e-mail.' });
    if (mode === 'reset') {
      setMsg({ ok: true, text: 'Mot de passe changé.' });
      setMode('in');
    }
    setPassword('');
  };
  if (!ready) return <div className="page"><span className="sk sk-hero" aria-busy="true" /></div>;
  if (user && mode !== 'reset')
    return (
      <div className="page">
        <header className="page-head">
          <span className="caps">Mon compte</span>
          <h1>Bonjour</h1>
          <p className="lede">{user.email}</p>
        </header>
        <div className="account-grid">
          <section className="panel account-card">
            <span className="caps">Formule</span>
            <p className="account-plan">
              <Lightning size={18} weight="fill" /> Découverte
            </p>
            <p className="muted small">Gratuit. Les abonnements arrivent bientôt.</p>
            {PRICING && (
              <div className="account-actions">
                <Link href="/abonnement" className="btn glass">
                  Voir les formules
                </Link>
              </div>
            )}
          </section>
          <section className="panel account-card">
            <span className="caps">Compte</span>
            <p className="muted small">Membre depuis le {new Date(user.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            <div className="account-actions">
              <button className="btn glass" onClick={() => void supabase?.auth.signOut()}>
                <SignOut size={16} /> Se déconnecter
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  const titles: Record<AuthMode, [string, string, string]> = {
    in: ['Connexion', 'Retrouve tes simulations et ton abonnement.', 'Se connecter'],
    up: ['Créer un compte', 'Un compte pour simuler sans limite.', 'Créer mon compte'],
    forgot: ['Mot de passe oublié', 'On t’envoie un lien par e-mail pour le changer.', 'Envoyer le lien'],
    reset: ['Nouveau mot de passe', 'Choisis ton nouveau mot de passe.', 'Enregistrer'],
  };
  const [title, lede, cta] = titles[mode];
  return (
    <div className="page">
      <div className="auth mesh mesh-auth">
        <form className="auth-card panel" onSubmit={submit}>
          <UserCircle size={34} weight="light" className="auth-icon" />
          <h1>{title}</h1>
          <p className="muted">{lede}</p>
          {!supabase && <p className="auth-msg">Les comptes ne sont pas encore configurés sur ce site.</p>}
          {mode !== 'reset' && (
            <label className="field">
              <span>E-mail</span>
              <span className="field-in">
                <Envelope size={18} />
                <input type="email" required autoComplete="email" placeholder="ton@email.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
              </span>
            </label>
          )}
          {mode !== 'forgot' && (
            <label className="field">
              <span>Mot de passe</span>
              <span className="field-in">
                <LockKey size={18} />
                <input type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="8 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} />
              </span>
            </label>
          )}
          {mode === 'in' && (
            <button type="button" className="auth-link" onClick={() => { setMode('forgot'); setMsg(undefined); }}>
              Mot de passe oublié ?
            </button>
          )}
          {msg && <p className={`auth-msg${msg.ok ? ' ok' : ''}`} role="status">{msg.text}</p>}
          <button type="submit" className="btn glass glass-brand btn-lg" disabled={busy || !supabase}>
            {busy && <span className="spin" />}
            {cta}
          </button>
          {mode !== 'reset' && (
            <p className="auth-switch">
              {mode === 'in' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
              <button type="button" className="auth-link" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(undefined); }}>
                {mode === 'in' ? 'Créer un compte' : 'Se connecter'}
              </button>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
