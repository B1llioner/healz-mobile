import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';

import { createIosFileInputActivationScript } from '../src/web/iosFileInputActivation';

type Timer = {
  callback: () => void;
  delay: number;
  id: number;
};

class FakeClassList {
  constructor(private readonly values: Set<string>) {}

  contains(value: string) {
    return this.values.has(value);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly classList: FakeClassList;
  disabled = false;
  parentElement: FakeElement | null = null;
  tagName: string;

  constructor(tagName: string, classes: string[] = []) {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList(new Set(classes));
  }

  append(...elements: FakeElement[]) {
    for (const element of elements) {
      element.parentElement = this;
      this.children.push(element);
    }
  }

  get nextElementSibling(): FakeElement | null {
    const siblings = this.parentElement?.children ?? [];
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }

  closest(selector: string): FakeElement | null {
    if (selector === 'button' && this.tagName === 'BUTTON') return this;
    if (
      selector === 'div.mt-1.flex.w-full.flex-row.items-center.gap-3'
      && this.tagName === 'DIV'
      && ['mt-1', 'flex', 'w-full', 'flex-row', 'items-center', 'gap-3']
        .every((name) => this.classList.contains(name))
    ) return this;
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(element: FakeElement): boolean {
    return this === element || this.children.some((child) => child.contains(element));
  }

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll(selector)]);
    if (selector !== 'input[type="file"][multiple]') return [];
    return descendants.filter((element) => (
      element instanceof FakeInput
      && element.type === 'file'
      && element.multiple
    ));
  }
}

class FakeButton extends FakeElement {
  constructor(classes = paperclipClasses) {
    super('button', classes);
  }
}

class FakeInput extends FakeElement {
  accept = 'application/pdf,image/*';
  multiple = true;
  type = 'file';

  constructor() {
    super('input', ['hidden']);
    this.attributes.set('capture', 'environment');
  }

  click() {}

  override setAttribute(name: string, value: string) {
    super.setAttribute(name, value);
    if (name === 'accept') this.accept = value;
  }
}

const paperclipClasses = [
  'group',
  'relative',
  'h-10',
  'w-10',
  'items-center',
  'justify-center',
  'rounded-xl',
];

function createComposer() {
  const composer = new FakeElement('div', [
    'mt-1',
    'flex',
    'w-full',
    'flex-row',
    'items-center',
    'gap-3',
  ]);
  const input = new FakeInput();
  const button = new FakeButton();
  const icon = new FakeElement('svg');
  button.append(icon);
  composer.append(input, button);
  return { button, composer, icon, input };
}

function createEnvironment(options: {
  hostname?: string;
  nativeBridge?: 'available' | 'missing' | 'throws';
  pathname?: string;
  port?: string;
  protocol?: string;
} = {}) {
  const listeners: Array<(event: Record<string, unknown>) => void> = [];
  const timers: Timer[] = [];
  const clicks: FakeInput[] = [];
  const clickOwnDescriptors: boolean[] = [];
  const bridgeMessages: unknown[] = [];
  const eventOrder: string[] = [];
  let timerId = 0;
  const location = {
    hostname: options.hostname ?? 'app.healz.ai',
    pathname: options.pathname ?? '/app/chat/case-1',
    port: options.port ?? '',
    protocol: options.protocol ?? 'https:',
  };
  const window = {
    clearTimeout(id: number) {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.callback = () => undefined;
    },
    location,
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId;
      timers.push({ callback, delay, id });
      return id;
    },
    webkit: options.nativeBridge === 'missing' ? undefined : {
      messageHandlers: {
        HealzUploadChooser: {
          postMessage(message: unknown) {
            eventOrder.push('bridge');
            if (options.nativeBridge === 'throws') {
              throw new Error('native bridge unavailable');
            }
            bridgeMessages.push(message);
          },
        },
      },
    },
  };
  const document = {
    addEventListener(type: string, listener: (event: Record<string, unknown>) => void, capture: boolean) {
      assert.equal(type, 'click');
      assert.equal(capture, true);
      listeners.push(listener);
    },
  };
  const nativeClick = FakeInput.prototype.click;
  FakeInput.prototype.click = function click() {
    clickOwnDescriptors.push(Object.hasOwn(this, 'click'));
    clicks.push(this);
    eventOrder.push('click');
  };

  vm.runInNewContext(createIosFileInputActivationScript(), {
    Array,
    Element: FakeElement,
    HTMLButtonElement: FakeButton,
    HTMLInputElement: FakeInput,
    Object,
    Set,
    WeakMap,
    document,
    window,
  });

  const dispatchClick = (target: FakeElement, isTrusted = true) => {
    for (const listener of listeners) {
      listener({ button: 0, isTrusted, target });
    }
  };
  const runTimersThrough = (maximumDelay: number) => {
    for (const timer of [...timers].sort((left, right) => left.delay - right.delay)) {
      if (timer.delay <= maximumDelay) timer.callback();
    }
  };

  return {
    bridgeMessages,
    clickOwnDescriptors,
    clicks,
    dispatchClick,
    eventOrder,
    listeners,
    location,
    runTimersThrough,
    scheduleSiteClick(input: FakeInput) {
      window.setTimeout(() => input.click(), 400);
    },
    restore() {
      FakeInput.prototype.click = nativeClick;
    },
  };
}

test('opens the exact live composer input synchronously and suppresses the 400ms duplicate', () => {
  const source = createIosFileInputActivationScript();
  assert.doesNotMatch(source, /HTMLInputElement\.prototype\.click\s*=/);
  assert.doesNotMatch(source, /(?:preventDefault|stopPropagation|stopImmediatePropagation)\s*\(/);

  const environment = createEnvironment();
  try {
    const { icon, input } = createComposer();
    environment.dispatchClick(icon);

    assert.deepEqual(JSON.parse(JSON.stringify(environment.bridgeMessages)), [{
      accept: 'application/pdf,image/*',
      multiple: true,
      path: '/app/chat/case-1',
      version: 1,
    }]);
    assert.deepEqual(environment.eventOrder, ['bridge', 'click']);
    assert.deepEqual(environment.clicks, [input]);
    assert.deepEqual(environment.clickOwnDescriptors, [false]);
    assert.equal(input.accept, '*/*');
    assert.equal(input.hasAttribute('capture'), false);

    environment.scheduleSiteClick(input);
    environment.runTimersThrough(400);
    assert.deepEqual(environment.clicks, [input]);

    environment.runTimersThrough(700);
    assert.equal(Object.hasOwn(input, 'click'), false);
    input.click();
    assert.deepEqual(environment.clicks, [input, input]);
  } finally {
    environment.restore();
  }
});

test('keeps the listener origin-scoped and evaluates the chat path at click time for SPA navigation', () => {
  for (const options of [
    { hostname: 'app.healz.ai.evil.example' },
    { protocol: 'http:' },
    { port: '8443' },
  ]) {
    const wrongOrigin = createEnvironment(options);
    try {
      assert.equal(wrongOrigin.listeners.length, 0);
    } finally {
      wrongOrigin.restore();
    }
  }

  const environment = createEnvironment({ pathname: '/' });
  try {
    const { icon, input } = createComposer();
    environment.dispatchClick(icon);
    assert.equal(environment.clicks.length, 0);
    assert.equal(environment.bridgeMessages.length, 0);

    environment.location.pathname = '/app/chat';
    environment.dispatchClick(icon);
    assert.deepEqual(environment.clicks, [input]);
    assert.deepEqual(JSON.parse(JSON.stringify(environment.bridgeMessages)), [{
      accept: 'application/pdf,image/*',
      multiple: true,
      path: '/app/chat',
      version: 1,
    }]);
  } finally {
    environment.restore();
  }
});

test('ignores untrusted clicks and buttons that are not the paperclip next to the input', () => {
  const environment = createEnvironment();
  try {
    const { composer, icon, input } = createComposer();
    environment.dispatchClick(icon, false);
    assert.equal(environment.clicks.length, 0);
    assert.equal(environment.bridgeMessages.length, 0);

    const otherButton = new FakeButton();
    const otherIcon = new FakeElement('svg');
    otherButton.append(otherIcon);
    composer.append(otherButton);
    environment.dispatchClick(otherIcon);
    assert.equal(environment.clicks.length, 0);
    assert.equal(environment.bridgeMessages.length, 0);

    input.disabled = true;
    environment.dispatchClick(icon);
    assert.equal(environment.clicks.length, 0);
    assert.equal(environment.bridgeMessages.length, 0);
  } finally {
    environment.restore();
  }
});

test('fails closed when more than one matching file input shares the composer', () => {
  const environment = createEnvironment();
  try {
    const { button, composer, icon } = createComposer();
    const extraInput = new FakeInput();
    composer.children.splice(composer.children.indexOf(button), 0, extraInput);
    extraInput.parentElement = composer;

    environment.dispatchClick(icon);
    assert.equal(environment.clicks.length, 0);
    assert.equal(environment.bridgeMessages.length, 0);
  } finally {
    environment.restore();
  }
});

test('keeps the synchronous stock picker path when the optional native handler is absent or throws', () => {
  for (const nativeBridge of ['missing', 'throws'] as const) {
    const environment = createEnvironment({ nativeBridge });
    try {
      const { icon, input } = createComposer();
      environment.dispatchClick(icon);

      assert.deepEqual(environment.clicks, [input]);
      assert.equal(environment.bridgeMessages.length, 0);
      assert.equal(environment.eventOrder.at(-1), 'click');
    } finally {
      environment.restore();
    }
  }
});

test('does not arm the native chooser for an unobserved file accept contract', () => {
  const environment = createEnvironment();
  try {
    const { icon, input } = createComposer();
    input.accept = 'image/png';
    environment.dispatchClick(icon);

    assert.equal(environment.bridgeMessages.length, 0);
    assert.equal(environment.clicks.length, 0);
  } finally {
    environment.restore();
  }
});

test('restores an existing own click descriptor and never touches a replacement React input', () => {
  const environment = createEnvironment();
  try {
    const { icon, input } = createComposer();
    const ownClick = () => undefined;
    Object.defineProperty(input, 'click', {
      configurable: true,
      enumerable: true,
      value: ownClick,
      writable: false,
    });
    const originalDescriptor = Object.getOwnPropertyDescriptor(input, 'click');

    environment.dispatchClick(icon);
    const replacement = new FakeInput();
    const replacementClick = () => undefined;
    Object.defineProperty(replacement, 'click', {
      configurable: true,
      value: replacementClick,
      writable: true,
    });
    environment.runTimersThrough(700);

    assert.deepEqual(Object.getOwnPropertyDescriptor(input, 'click'), originalDescriptor);
    assert.equal(replacement.click, replacementClick);
  } finally {
    environment.restore();
  }
});
