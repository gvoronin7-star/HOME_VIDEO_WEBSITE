/**
 * Bind every prototype method of an instance to that instance.
 *
 * Express receives route handlers as detached references
 * (`router.post('/', controller.create)`), so `this` inside a handler is
 * `undefined` — class bodies are strict mode. Any handler that touches `this`
 * then throws a TypeError at request time, which the compiler cannot catch.
 *
 * Calling this from a controller constructor makes every handler safe to pass
 * by reference, including handlers added later.
 */
export function bindAll<T extends object>(instance: T): void {
  const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;

  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') continue;

    const value = (instance as Record<string, unknown>)[key];
    if (typeof value === 'function') {
      (instance as Record<string, unknown>)[key] = value.bind(instance);
    }
  }
}
