// Compte (en ligne) : connexion par e-mail avec Supabase. Abonnement : page prête mais pas en ligne (VITE_BILLING=1),
// paiement pas encore branché ; les prix sont indicatifs, à valider avant l'ouverture.
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';
import { endRecovery, useAuth } from './auth.ts';
import { useTickets } from './suivi.ts';
import { WarpBg } from './shaders.tsx';
import {
  AppleLogo, ArrowUpRight, Bell, CalendarCheck, ChartLineUp, Check, CreditCard, Crown, Envelope, GoogleLogo, Infinity as InfinityIcon,
  Eye, EyeSlash, Lightning, ListChecks, LockKey, Receipt, Scales, ShieldCheck, SignOut, Sparkle, Star, Trophy, UserCircle,
} from '@phosphor-icons/react';
import { Link, navigate, Segmented } from './ui.tsx';

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
// Après connexion, retour à la page demandée (ex. /suivi) ; seulement un chemin du site.
// (Google renvoie sur /compte : la page de retour est gardée le temps de l'aller-retour.)
const nextPath = () => {
  let n = new URLSearchParams(location.search).get('next');
  try {
    n ??= sessionStorage.getItem('razzia-next');
  } catch {
    /* stockage indisponible */
  }
  return n && n.startsWith('/') && !n.startsWith('//') ? n : null;
};
const forgetNext = () => {
  try {
    sessionStorage.removeItem('razzia-next');
  } catch {
    /* idem */
  }
};

/** Compte : connexion, création, mot de passe oublié (Supabase), puis l'espace du compte. Pas encore de paiement. */
export function AccountPage() {
  const { ready, user, recovery } = useAuth();
  const [mode, setMode] = useState<AuthMode>(() => (new URLSearchParams(location.search).get('mode') === 'up' ? 'up' : 'in'));
  useEffect(() => {
    if (recovery) setMode('reset');
  }, [recovery]);
  // Connecté avec une page de retour : on y va directement.
  useEffect(() => {
    const n = nextPath();
    if (user && !recovery && n) {
      forgetNext();
      navigate(n);
    }
  }, [user, recovery]);
  if (!ready) return <div className="page"><span className="sk sk-hero" aria-busy="true" /></div>;
  if (user && mode !== 'reset') return <AccountSpace user={user} />;
  return <AuthScreen mode={mode} setMode={setMode} />;
}

function AuthScreen({ mode, setMode }: { mode: AuthMode; setMode: (m: AuthMode) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  // Connexion Google (activée dans Supabase, Authentication, Providers).
  const oauth = async (provider: 'google') => {
    if (!supabase) return;
    const n = nextPath();
    try {
      if (n) sessionStorage.setItem('razzia-next', n);
    } catch {
      /* stockage indisponible */
    }
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/compte` } });
    if (error) setMsg({ ok: false, text: /not enabled|unsupported provider/i.test(error.message) ? "La connexion Google n'est pas encore activée." : authError(error.message) });
  };
  const go = (m: AuthMode) => {
    setMode(m);
    setMsg(undefined);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(undefined);
    const back = `${location.origin}/compte${nextPath() ? `?next=${encodeURIComponent(nextPath()!)}` : ''}`;
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
      endRecovery();
      setMsg({ ok: true, text: 'Mot de passe changé.' });
      setMode('in');
    }
    setPassword('');
  };
  const titles: Record<AuthMode, [string, string, string]> = {
    in: ['Bon retour', 'Connecte-toi pour retrouver ton suivi et ton bilan.', 'Se connecter'],
    up: ['Créer un compte', 'Gratuit. Ton suivi de paris et ton bilan, sur tous tes appareils.', 'Créer mon compte'],
    forgot: ['Mot de passe oublié', 'On t’envoie un lien par e-mail pour le changer.', 'Envoyer le lien'],
    reset: ['Nouveau mot de passe', 'Choisis ton nouveau mot de passe.', 'Enregistrer'],
  };
  const [title, lede, cta] = titles[mode];
  const strength = mode === 'up' || mode === 'reset' ? Math.min(3, (password.length >= 8 ? 1 : 0) + (/\d/.test(password) ? 1 : 0) + (/[^A-Za-z0-9]/.test(password) || /[A-Z]/.test(password) ? 1 : 0)) : -1;
  return (
    <div className="page">
      <div className="auth2">
        <aside className="auth-side mesh has-shader">
          <WarpBg c1="#2f9a68" c2="#1f3f6e" />
          <span className="caps">Razzia · compte gratuit</span>
          <h2>
            Simule.
            <br />
            Suis.
            <br />
            <em>Fais le bilan.</em>
          </h2>
          <ul className="auth-perks">
            <li>
              <span><ChartLineUp size={18} /></span>
              <div>
                <b>25 000 simulations par match</b>
                <p>NBA et ATP, avec les compos et les cotes du moment.</p>
              </div>
            </li>
            <li>
              <span><ListChecks size={18} /></span>
              <div>
                <b>Ton suivi de paris</b>
                <p>Simples et combinés, validés tout seuls après chaque match.</p>
              </div>
            </li>
            <li>
              <span><Trophy size={18} /></span>
              <div>
                <b>Ton bilan</b>
                <p>Mises, gains, taux de réussite : tout est compté pour toi.</p>
              </div>
            </li>
          </ul>
        </aside>
        <form className="auth-card2" onSubmit={submit}>
          {(mode === 'in' || mode === 'up') && (
            <Segmented<AuthMode>
              ariaLabel="Connexion ou création de compte"
              value={mode}
              onChange={go}
              options={[
                { value: 'in', label: 'Connexion' },
                { value: 'up', label: 'Créer un compte' },
              ]}
            />
          )}
          <div className="auth-head">
            <h1>{title}</h1>
            <p className="muted">{lede}</p>
          </div>
          {!supabase && <p className="auth-msg">Les comptes ne sont pas encore configurés sur ce site.</p>}
          {(mode === 'in' || mode === 'up') && (
            <>
              <div className="auth-social">
                <button type="button" className="btn glass btn-lg" onClick={() => void oauth('google')} disabled={!supabase}>
                  <GoogleLogo size={18} weight="bold" /> Continuer avec Google
                </button>
              </div>
              <p className="auth-or">ou par e-mail</p>
            </>
          )}
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
                <input type={show ? 'text' : 'password'} required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="8 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="field-eye" onClick={() => setShow(!show)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                  {show ? <EyeSlash size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          )}
          {strength >= 0 && password && (
            <div className={`pw-meter s${strength}`} aria-label="Solidité du mot de passe">
              <span />
              <span />
              <span />
              <em>{['Trop court', 'Faible', 'Correct', 'Solide'][strength]}</em>
            </div>
          )}
          {mode === 'in' && (
            <button type="button" className="auth-link" onClick={() => go('forgot')}>
              Mot de passe oublié ?
            </button>
          )}
          {msg && <p className={`auth-msg${msg.ok ? ' ok' : ''}`} role="status">{msg.text}</p>}
          <button type="submit" className="btn btn-primary btn-lg auth-go" disabled={busy || !supabase}>
            {busy && <span className="spin" />}
            {cta}
          </button>
          {mode === 'up' && <p className="auth-legal">En créant un compte, tu confirmes avoir 18 ans ou plus. Jouer comporte des risques.</p>}
          {(mode === 'forgot' || mode === 'reset') && (
            <button type="button" className="auth-link center" onClick={() => go('in')}>
              Retour à la connexion
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Espace du compte : en-tête avec initiale, bilan du suivi, derniers tickets, formule, sécurité. */
function AccountSpace({ user }: { user: User }) {
  const { tickets } = useTickets(user.id);
  const [sent, setSent] = useState<string>();
  const name = (user.email ?? '').split('@')[0];
  const done = (tickets ?? []).filter((t) => t.status !== 'pending');
  const won = done.filter((t) => t.status === 'won');
  const staked = done.reduce((x, t) => x + t.stake, 0);
  const profit = won.reduce((x, t) => x + t.stake * t.odds, 0) - staked;
  const open = (tickets ?? []).filter((t) => t.status === 'pending');
  const resetPw = async () => {
    if (!supabase || !user.email) return;
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${location.origin}/compte` });
    setSent(error ? authError(error.message) : `Lien envoyé à ${user.email}.`);
  };
  return (
    <div className="page">
      <header className="acct-hero mesh has-shader">
        <WarpBg c1="#2f9a68" c2="#1f3f6e" />
        <span className="acct-ava" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
        <div className="acct-id">
          <span className="caps">Mon compte</span>
          <h1>{name}</h1>
          <p>
            {user.email} · membre depuis {new Date(user.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
          </p>
        </div>
        <span className="acct-plan-tag">
          <Lightning size={14} weight="fill" /> Découverte
        </span>
      </header>
      <dl className="acct-stats">
        <div>
          <dt>Tickets joués</dt>
          <dd>{tickets ? tickets.length : '-'}</dd>
        </div>
        <div>
          <dt>Réussite</dt>
          <dd>{done.length ? `${Math.round((won.length / done.length) * 100)} %` : '-'}</dd>
        </div>
        <div>
          <dt>Bilan</dt>
          <dd className={profit > 0 ? 'up' : profit < 0 ? 'down' : ''}>{done.length ? `${profit > 0 ? '+' : profit < 0 ? '−' : ''}${eur(Math.abs(profit))}` : '-'}</dd>
        </div>
        <div>
          <dt>En cours</dt>
          <dd>{open.length}</dd>
        </div>
      </dl>
      <div className="account-grid">
        <section className="panel account-card wide">
          <div className="acct-row-head">
            <span className="caps">Derniers tickets</span>
            <Link href="/suivi" className="btn glass">
              <ListChecks size={16} /> Ouvrir mon suivi
            </Link>
          </div>
          {tickets && tickets.length === 0 && <p className="muted small">Aucun ticket pour l’instant. Ajoute des paris depuis une fiche de match avec « Suivre ».</p>}
          <ul className="acct-tk">
            {(tickets ?? []).slice(0, 4).map((t) => (
              <li key={t.id}>
                <span className={`tk-st ${t.status}`}>{t.status === 'won' ? 'Gagné' : t.status === 'lost' ? 'Perdu' : 'En cours'}</span>
                <span className="acct-tk-t">{t.kind === 'combine' ? `Combiné · ${t.legs.length} sélections` : t.legs[0]?.title}</span>
                <span className="mono muted">{t.odds.toFixed(2).replace('.', ',')}</span>
                <span className="mono">{eur(t.stake)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel account-card">
          <span className="caps">Formule</span>
          <p className="account-plan">
            <Lightning size={18} weight="fill" /> Découverte
          </p>
          <ul className="acct-feats">
            <li><Check size={15} weight="bold" /> Simulations NBA et ATP</li>
            <li><Check size={15} weight="bold" /> Suivi des paris et combinés</li>
            <li><Check size={15} weight="bold" /> Bilan automatique</li>
          </ul>
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
          <span className="caps">Sécurité</span>
          <p className="muted small">Connecté avec {user.email}.</p>
          <div className="account-actions">
            <button className="btn glass" onClick={() => void resetPw()}>
              <LockKey size={16} /> Changer le mot de passe
            </button>
            <button className="btn glass" onClick={() => void supabase?.auth.signOut()}>
              <SignOut size={16} /> Se déconnecter
            </button>
          </div>
          {sent && <p className="auth-msg ok" role="status">{sent}</p>}
        </section>
      </div>
    </div>
  );
}
