// Pages légales (mentions, CGU, CGV, confidentialité) et page introuvable. Forme juridique, siège et SIRET sont en cours de
// validation : à compléter avant l'ouverture des abonnements.
import type { ReactNode } from 'react';
import { Link } from './ui.tsx';

/** Adresse de contact de Razzia (pages légales, pied de page, espace compte). */
export const CONTACT = 'razzia.support@gmail.com';
const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export const LEGAL: Record<string, { title: string; body: ReactNode }> = {
  '/mentions-legales': {
    title: 'Mentions légales',
    body: (
      <>
        <h2>Éditeur</h2>
        <p>
          Razzia est édité par la société Razzia. Forme juridique et capital : en cours de validation. Siège social : en cours de validation. Numéro SIRET : en
          cours de validation. Directeur de la publication : M. H. Contact : <Mail />.
        </p>
        <h2>Hébergement</h2>
        <p>Le site est hébergé par Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis. Les comptes et les tickets sont stockés chez Supabase Inc.</p>
        <h2>Ce que fait Razzia</h2>
        <p>
          Razzia analyse des rencontres sportives à l'aide de simulations. Razzia n'est pas un opérateur de jeux d'argent : il ne prend aucun pari et ne reçoit aucune mise.
          Les probabilités affichées sont des estimations, pas des certitudes.
        </p>
        <h2>Jeu responsable</h2>
        <p>
          Le site est réservé aux personnes majeures. Jouer comporte des risques : endettement, isolement, dépendance. Pour être aidé, appelez le 09 74 75 13 13 (appel non
          surtaxé) ou rendez-vous sur joueurs-info-service.fr.
        </p>
        <h2>Propriété intellectuelle</h2>
        <p>Les contenus du site (textes, graphismes, logo, simulations) sont la propriété de l'éditeur. Les logos d'équipes et noms de compétitions appartiennent à leurs titulaires.</p>
      </>
    ),
  },
  '/cgu': {
    title: 'Conditions générales d’utilisation',
    body: (
      <>
        <h2>Objet</h2>
        <p>Les présentes conditions encadrent l'utilisation du site Razzia et de ses services : programme, simulations, suivi des paris, bilan.</p>
        <h2>Accès</h2>
        <p>L'accès est réservé aux personnes majeures. Certaines fonctions demandent un compte, créé avec une adresse e-mail valide ou un compte Google.</p>
        <h2>Nature des informations</h2>
        <p>
          Les simulations et probabilités sont fournies à titre informatif. Elles ne constituent ni un conseil financier ni une garantie de résultat. L'utilisateur reste seul
          responsable de ses décisions et de ses paris, placés chez des opérateurs agréés.
        </p>
        <h2>Compte</h2>
        <p>L'utilisateur garde ses identifiants confidentiels. Il peut supprimer son compte à tout moment en écrivant à <Mail />.</p>
        <h2>Disponibilité</h2>
        <p>L'éditeur fait son possible pour assurer l'accès au site, sans pouvoir garantir une disponibilité continue (maintenance, données des fournisseurs, réseau).</p>
        <h2>Droit applicable</h2>
        <p>Ces conditions sont soumises au droit français.</p>
      </>
    ),
  },
  '/cgv': {
    title: 'Conditions générales de vente',
    body: (
      <>
        <h2>Formules</h2>
        <p>Razzia propose des abonnements mensuels ou annuels (Razzia Pro, Razzia Elite). Les prix affichés sont en euros, toutes taxes comprises.</p>
        <h2>Essai gratuit</h2>
        <p>
          Chaque formule commence par 3 jours d'essai gratuit. Aucun prélèvement n'a lieu pendant l'essai. Sans résiliation avant la fin de l'essai, l'abonnement démarre et le
          premier paiement est prélevé.
        </p>
        <h2>Paiement et renouvellement</h2>
        <p>Le paiement se fait par carte, Apple Pay ou Google Pay, via un prestataire sécurisé. L'abonnement se renouvelle automatiquement à chaque échéance.</p>
        <h2>Résiliation</h2>
        <p>L'abonnement est sans engagement : il se résilie en un clic depuis la page Compte et reste actif jusqu'à la fin de la période payée.</p>
        <h2>Droit de rétractation</h2>
        <p>
          Le service étant fourni immédiatement après la souscription, l'utilisateur accepte qu'il commence avant la fin du délai de rétractation de 14 jours et renonce à ce
          droit pour la période entamée, conformément à l'article L221-28 du Code de la consommation.
        </p>
        <h2>Contact</h2>
        <p>Pour toute question sur un paiement : <Mail />.</p>
      </>
    ),
  },
  '/confidentialite': {
    title: 'Politique de confidentialité',
    body: (
      <>
        <h2>Données collectées</h2>
        <p>
          Adresse e-mail et identifiant de connexion (dont Google si tu l'utilises), tickets suivis (paris, mises, cotes, résultats), et, une fois les abonnements
          ouverts, les informations de facturation tenues par le prestataire de paiement.
        </p>
        <h2>Pourquoi</h2>
        <p>Pour faire fonctionner ton compte, ton suivi et ton bilan, et pour gérer ton abonnement. Aucune donnée n'est vendue ni utilisée pour de la publicité.</p>
        <h2>Où et combien de temps</h2>
        <p>Les données sont hébergées chez Supabase et Vercel. Elles sont gardées tant que le compte existe, puis supprimées.</p>
        <h2>Stockage dans le navigateur</h2>
        <p>Le site garde dans ton navigateur ton ticket en préparation et tes préférences d'affichage. Il n'utilise pas de cookies publicitaires.</p>
        <h2>Tes droits</h2>
        <p>
          Tu peux accéder à tes données, les corriger, les supprimer ou les récupérer en écrivant à <Mail />. Tu peux aussi saisir la CNIL (cnil.fr).
        </p>
      </>
    ),
  },
};

export function LegalPage({ path }: { path: string }) {
  const p = LEGAL[path];
  return (
    <div className="page prose legal">
      <header className="page-head">
        <h1>{p.title}</h1>
        <p className="lede">Dernière mise à jour : {new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</p>
      </header>
      {p.body}
    </div>
  );
}

/** Page introuvable : simple, et un retour au programme. */
export function NotFound() {
  return (
    <div className="page notfound">
      <p className="notfound-n">404</p>
      <h1>Cette page n’existe pas.</h1>
      <p className="muted">Le lien est peut-être ancien, ou l’adresse mal tapée.</p>
      <Link href="/" className="btn btn-primary btn-lg">
        Retour au programme
      </Link>
    </div>
  );
}

/** Liens légaux du pied de page. */
export function LegalLinks() {
  return (
    <nav className="foot-links" aria-label="Informations légales">
      <Link href="/mentions-legales">Mentions légales</Link>
      <Link href="/cgu">CGU</Link>
      <Link href="/cgv">CGV</Link>
      <Link href="/confidentialite">Confidentialité</Link>
      <a href={`mailto:${CONTACT}`}>Contact</a>
    </nav>
  );
}
