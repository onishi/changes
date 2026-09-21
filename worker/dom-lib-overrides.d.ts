// worker/render.tsx needs the DOM lib for React's JSX event types (e.g.
// HTMLInputElement, HTMLDivElement), so tsconfig.worker.json includes it
// alongside @cloudflare/workers-types. workers-types declares SubtleCrypto
// as `declare abstract class`, which doesn't merge with lib.dom.d.ts's
// `interface SubtleCrypto` the way two interfaces would, silently losing
// this Workers-only method. Re-add it via interface augmentation, which
// does merge.
interface SubtleCrypto {
  timingSafeEqual(
    a: ArrayBuffer | ArrayBufferView,
    b: ArrayBuffer | ArrayBufferView,
  ): boolean;
}
