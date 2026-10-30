// Messages courts en bas de l'écran (pari validé, ticket gagné...). Ils partent seuls après quelques secondes.
import { useEffect, useState } from 'react';
import { CheckCircle, Info, XCircle, X } from '@phosphor-icons/react';
import { Link } from './ui.tsx';

type Tone = 'ok' | 'bad' | 'info';
interface Toast { id: number; tone: Tone; title: string; text?: string; href?: string }
const EVENT = 'razzia-toast';
let next = 1;

export function toast(t: Omit<Toast, 'id'>) {
  dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { ...t, id: next++ } }));
}

export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setList((l) => [...l.slice(-3), t]);
      window.setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 7000);
    };
    addEventListener(EVENT, on);
    return () => removeEventListener(EVENT, on);
  }, []);
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => {
        const body = (
          <>
            <span className={`toast-ic ${t.tone}`}>{t.tone === 'ok' ? <CheckCircle size={22} weight="fill" /> : t.tone === 'bad' ? <XCircle size={22} weight="fill" /> : <Info size={22} weight="fill" />}</span>
            <span className="toast-t">
              <b>{t.title}</b>
              {t.text && <span>{t.text}</span>}
            </span>
          </>
        );
        return (
          <div key={t.id} className="toast">
            {t.href ? (
              <Link href={t.href} className="toast-main">
                {body}
              </Link>
            ) : (
              <div className="toast-main">{body}</div>
            )}
            <button className="toast-x" onClick={() => setList((l) => l.filter((x) => x.id !== t.id))} aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
