export type ToastVariant = 'success' | 'error';

const HOST_ID = 'forage-toast-host';

// Non-blocking: no focus steal, no pointer capture, announced politely, auto-dismissed.
export function showToast(
  message: string,
  { variant = 'success', durationMs = 2500, doc = document } = {} as {
    variant?: ToastVariant;
    durationMs?: number;
    doc?: Document;
  },
): HTMLElement {
  doc.getElementById(HOST_ID)?.remove();

  const host = doc.createElement('div');
  host.id = HOST_ID;
  // Shadow root keeps page styles out of the toast and ours out of the page.
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      .toast {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        max-width: 320px; padding: 10px 14px; border-radius: 8px;
        font: 500 14px/1.4 system-ui, sans-serif; color: #fff;
        background: #2f3b2f; box-shadow: 0 4px 16px rgb(0 0 0 / 0.2);
        pointer-events: none; opacity: 0; transform: translateY(8px);
        transition: opacity 150ms, transform 150ms;
      }
      .toast.error { background: #7a2e2e; }
      .toast.visible { opacity: 1; transform: none; }
      @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
    </style>
    <div class="toast ${variant}" role="${variant === 'error' ? 'alert' : 'status'}" aria-live="${variant === 'error' ? 'assertive' : 'polite'}"></div>
  `;
  const toast = shadow.querySelector<HTMLElement>('.toast')!;
  toast.textContent = message;

  doc.documentElement.append(host);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => host.remove(), durationMs);
  return host;
}
