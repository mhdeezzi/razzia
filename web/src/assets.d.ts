// Images importées par Vite : leur adresse publiée.
declare module '*.webp' {
  const src: string;
  export default src;
}
declare module '*.png' {
  const src: string;
  export default src;
}

// Variables de build Vite (VITE_*), lues par import.meta.env.
interface ImportMetaEnv {
  readonly VITE_BILLING?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
