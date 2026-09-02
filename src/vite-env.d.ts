/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RENDERER?: 'pixi' | 'canvas';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
