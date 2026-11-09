// A test's way of taking a service's Guard down: the in-memory fake behind it keeps its state, and while the outage lasts every call fails as a stopped Guard does
// (connection refused, nothing sent). The tests of each template use it so that the same outage is tried over each template's own agent.
import { NotSentError } from "../../core/faults.ts";

export interface Outage<S> { service: S; down(): void; up(): void }

export function outage<S extends object>(service: S, name: string): Outage<S> {
  let isDown = false;
  const wrapped = new Proxy(service, {
    get(t, property) {
      const value = Reflect.get(t, property, t) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (isDown) return Promise.reject(new NotSentError(`${name}: could not connect (ECONNREFUSED).`, "ECONNREFUSED"));
        return Reflect.apply(value as (...a: unknown[]) => unknown, t, args);
      };
    },
  });
  return { service: wrapped, down: () => { isDown = true; }, up: () => { isDown = false; } };
}
