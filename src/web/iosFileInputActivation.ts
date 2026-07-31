const HEALZ_ORIGIN = {
  protocol: 'https:',
  hostname: 'app.healz.ai',
  ports: ['', '443'],
} as const;

const CHAT_PATH = '/app/chat';
const DUPLICATE_CLICK_GUARD_MS = 700;

/**
 * Builds a document-start shim for one observed iOS WebKit incompatibility in
 * the public Healz composer. The live paperclip handler waits 400 ms before it
 * calls the hidden file input, while WebKit may require that call to remain in
 * the trusted tap's synchronous stack.
 *
 * The generated code intentionally fails closed when the live DOM contract
 * changes. It never replaces a prototype and is installed by App.tsx on iOS
 * only, so the Android staged-file chooser bridge remains untouched.
 */
export function createIosFileInputActivationScript(): string {
  return `(() => {
    'use strict';

    const marker = '__healzIosFileInputActivationV1';
    const location = window.location;
    const allowedPorts = new Set(${JSON.stringify([...HEALZ_ORIGIN.ports])});
    if (
      window[marker]
      || location.protocol !== ${JSON.stringify(HEALZ_ORIGIN.protocol)}
      || location.hostname !== ${JSON.stringify(HEALZ_ORIGIN.hostname)}
      || !allowedPorts.has(location.port)
    ) return;

    window[marker] = true;

    const chatPath = ${JSON.stringify(CHAT_PATH)};
    const allowedAccepts = new Set(['application/pdf,image/*', '*/*']);
    const activeShadows = new WeakMap();
    const nativeInputClick = HTMLInputElement.prototype.click;
    const composerSelector = 'div.mt-1.flex.w-full.flex-row.items-center.gap-3';
    const fileInputSelector = 'input[type="file"][multiple]';
    const paperclipButtonClasses = [
      'group',
      'relative',
      'h-10',
      'w-10',
      'items-center',
      'justify-center',
      'rounded-xl',
    ];

    const isChatPath = () => (
      location.pathname === chatPath
      || location.pathname.startsWith(chatPath + '/')
    );

    const resolveComposerInput = (button) => {
      if (
        !(button instanceof HTMLButtonElement)
        || button.disabled
        || button.hasAttribute('data-add-doctor-button')
        || !paperclipButtonClasses.every((className) => button.classList.contains(className))
      ) return null;

      const composer = button.closest(composerSelector);
      if (!composer) return null;

      const inputs = Array.from(composer.querySelectorAll(fileInputSelector)).filter((input) => (
        input instanceof HTMLInputElement
        && !input.disabled
        && input.classList.contains('hidden')
        && allowedAccepts.has(input.accept)
      ));
      if (inputs.length !== 1) return null;

      const input = inputs[0];
      const nextElement = input.nextElementSibling;
      if (nextElement !== button && !(nextElement && nextElement.contains(button))) return null;
      return input;
    };

    const shadowDelayedClick = (input) => {
      const currentDescriptor = Object.getOwnPropertyDescriptor(input, 'click');
      const previousState = activeShadows.get(input);
      const previousShadowIsCurrent = Boolean(
        previousState
        && currentDescriptor
        && currentDescriptor.value === previousState.shadow,
      );
      const originalDescriptor = previousShadowIsCurrent
        ? previousState.originalDescriptor
        : currentDescriptor;

      if (previousState) window.clearTimeout(previousState.timer);

      const shadow = function () {};
      try {
        Object.defineProperty(input, 'click', {
          configurable: true,
          enumerable: false,
          writable: true,
          value: shadow,
        });
      } catch {
        activeShadows.delete(input);
        return;
      }

      const state = { originalDescriptor, shadow, timer: 0 };
      state.timer = window.setTimeout(() => {
        if (activeShadows.get(input) !== state) return;
        activeShadows.delete(input);

        const descriptor = Object.getOwnPropertyDescriptor(input, 'click');
        if (!descriptor || descriptor.value !== shadow) return;
        if (originalDescriptor) {
          Object.defineProperty(input, 'click', originalDescriptor);
        } else {
          delete input.click;
        }
      }, ${DUPLICATE_CLICK_GUARD_MS});
      activeShadows.set(input, state);
    };

    const armNativeStagedChooser = (input) => {
      try {
        const handler = window.webkit?.messageHandlers?.HealzUploadChooser;
        if (!handler || typeof handler.postMessage !== 'function') return;
        handler.postMessage({
          version: 1,
          path: location.pathname,
          multiple: input.multiple === true,
          accept: input.accept,
        });
      } catch {
        // Stock Safari picker remains available when the optional bridge is absent.
      }
    };

    document.addEventListener('click', (event) => {
      if (
        !isChatPath()
        || !event.isTrusted
        || (typeof event.button === 'number' && event.button !== 0)
        || !(event.target instanceof Element)
      ) return;

      const button = event.target.closest('button');
      const input = resolveComposerInput(button);
      if (!input) return;

      try {
        armNativeStagedChooser(input);
        input.setAttribute('accept', '*/*');
        input.removeAttribute('capture');
        nativeInputClick.call(input);
        shadowDelayedClick(input);
      } catch {
        // Keep the site's delayed stock picker as the fallback.
      }
    }, true);
  })(); true;`;
}
