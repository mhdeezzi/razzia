// Apparition au défilement : les blocs d'une fiche ne jouent leur animation d'entrée qu'en arrivant à l'écran, au lieu de
// la jouer au chargement, hors de vue. En deux temps : le cadre du bloc apparaît dès qu'il pointe en bas de l'écran
// (data-seen), son contenu (barres, courbes, lignes) s'anime une fois le bloc bien entré (data-in). Ces attributs ne
// sont pas gérés par React ; tant qu'un bloc ne les a pas, le CSS met ses animations en pause (styles.css, « html.io »).
const BLOCKS = '.section, .verdict, .lv-box';

if (typeof IntersectionObserver !== 'undefined' && typeof MutationObserver !== 'undefined' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = (attr: string, rootMargin: string) => {
    const io: IntersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) {
            e.target.setAttribute(attr, '');
            io.unobserve(e.target);
          }
      },
      { rootMargin },
    );
    return io;
  };
  const frame = observer('data-seen', '0px');
  const inner = observer('data-in', '0px 0px -12% 0px');
  const add = (el: Element) => {
    if (!el.hasAttribute('data-seen')) frame.observe(el);
    if (!el.hasAttribute('data-in')) inner.observe(el);
  };
  // Filet de sécurité : en bas de page (ou sur une page qui ne défile pas), plus rien ne reste en attente.
  let queued = false;
  const settle = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      if (innerHeight + scrollY < document.documentElement.scrollHeight - 8) return;
      document.querySelectorAll(BLOCKS).forEach((el) => {
        el.setAttribute('data-seen', '');
        el.setAttribute('data-in', '');
      });
    });
  };
  new MutationObserver((list) => {
    for (const m of list)
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n.matches(BLOCKS)) add(n);
        n.querySelectorAll(BLOCKS).forEach(add);
      });
    settle();
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', settle, { passive: true });
  addEventListener('resize', settle, { passive: true });
  document.documentElement.classList.add('io');
  document.querySelectorAll(BLOCKS).forEach(add);
}
