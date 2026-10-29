// Abonnement et compte : pages prêtes mais pas en ligne (activées par VITE_BILLING=1 au build, voir main.tsx).
// Rien n'est encore branché : ni paiement, ni connexion. Les prix sont indicatifs, à valider avant l'ouverture.
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import {
  AppleLogo, ArrowUpRight, Bell, CalendarCheck, ChartLineUp, Check, CreditCard, Crown, Envelope, GoogleLogo, Infinity as InfinityIcon,
  Lightning, LockKey, Receipt, Scales, ShieldCheck, Sparkle, Star, UserCircle,
} from '@phosphor-icons/react';
import { Link, Segmented } from './ui.tsx';

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

/** Compte : connexion ou création, puis aperçu de l'espace abonné (formule, moyen de paiement, factures). */
export function AccountPage() {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [signed, setSigned] = useState(false);
  const [email, setEmail] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSigned(true); // aperçu seulement : aucune connexion n'est encore branchée
  };
  if (signed)
    return (
      <div className="page">
        <header className="page-head">
          <span className="caps">Mon compte</span>
          <h1>Bonjour</h1>
          <p className="lede">{email || 'ton@email.fr'}</p>
        </header>
        <div className="account-grid">
          <section className="panel account-card">
            <span className="caps">Formule</span>
            <p className="account-plan">
              <Lightning size={18} weight="fill" /> Razzia Pro
            </p>
            <p className="muted small">Prochain paiement le 1er décembre : 9,99 €</p>
            <div className="account-actions">
              <Link href="/abonnement" className="btn glass">
                Changer de formule
              </Link>
              <button className="btn btn-quiet">Résilier</button>
            </div>
          </section>
          <section className="panel account-card">
            <span className="caps">Moyen de paiement</span>
            <div className="pay-card">
              <CreditCard size={22} />
              <div>
                <p className="strong">Visa •••• 4242</p>
                <p className="muted small">Expire 08/29</p>
              </div>
            </div>
            <div className="account-actions">
              <button className="btn glass">Modifier</button>
            </div>
          </section>
          <section className="panel account-card wide">
            <span className="caps">Factures</span>
            <ul className="invoices">
              {['1er novembre', '1er octobre', '1er septembre'].map((d) => (
                <li key={d}>
                  <Receipt size={18} />
                  <span>{d}</span>
                  <span className="mono">9,99 €</span>
                  <span className="pill-tag final">Payée</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <p className="note center">Aperçu : la connexion et le paiement ne sont pas encore branchés.</p>
      </div>
    );
  return (
    <div className="page">
      <div className="auth mesh mesh-auth">
        <form className="auth-card panel" onSubmit={submit}>
          <UserCircle size={34} weight="light" className="auth-icon" />
          <h1>{mode === 'in' ? 'Connexion' : 'Créer un compte'}</h1>
          <p className="muted">{mode === 'in' ? 'Retrouve tes simulations et ton abonnement.' : 'Un compte pour simuler sans limite.'}</p>
          <div className="auth-social">
            <button type="button" className="btn glass" onClick={() => setSigned(true)}>
              <AppleLogo size={18} weight="fill" /> Continuer avec Apple
            </button>
            <button type="button" className="btn glass" onClick={() => setSigned(true)}>
              <GoogleLogo size={18} weight="bold" /> Continuer avec Google
            </button>
          </div>
          <p className="auth-or">
            <span>ou</span>
          </p>
          <label className="field">
            <span>E-mail</span>
            <span className="field-in">
              <Envelope size={18} />
              <input type="email" required autoComplete="email" placeholder="ton@email.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </span>
          </label>
          <label className="field">
            <span>Mot de passe</span>
            <span className="field-in">
              <LockKey size={18} />
              <input type="password" required minLength={8} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="8 caractères minimum" />
            </span>
          </label>
          {mode === 'in' && (
            <button type="button" className="auth-link">
              Mot de passe oublié ?
            </button>
          )}
          <button type="submit" className="btn glass glass-brand btn-lg">
            {mode === 'in' ? 'Se connecter' : 'Créer mon compte'}
          </button>
          <p className="auth-switch">
            {mode === 'in' ? 'Pas encore de compte ?' : 'Déjà un compte ?'}{' '}
            <button type="button" className="auth-link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
              {mode === 'in' ? 'Créer un compte' : 'Se connecter'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
