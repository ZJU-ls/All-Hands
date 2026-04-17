import { describe, it, expect } from "vitest";
import { registerComponent, resolveComponent, registeredComponents } from "../component-registry";
import type { RenderProps } from "../component-registry";

// Minimal stub component that satisfies ComponentType<RenderProps>
function makeStub(): (props: RenderProps) => null {
  return function stub() {
    return null;
  };
}

describe("ComponentRegistry (render)", () => {
  it("resolves a registered component", () => {
    const Foo = makeStub();
    const name = `TestComp_${Math.random()}`;
    registerComponent(name, Foo);
    const Resolved = resolveComponent(name);
    expect(Resolved).toBe(Foo);
  });

  it("returns undefined for unknown component", () => {
    expect(resolveComponent("NonExistent_xyz_abc")).toBeUndefined();
  });

  it("throws on duplicate registration", () => {
    const Bar = makeStub();
    const name = `DupComp_${Math.random()}`;
    registerComponent(name, Bar);
    expect(() => registerComponent(name, Bar)).toThrow(/duplicate/);
  });

  it("registeredComponents returns a sorted array", () => {
    const list = registeredComponents();
    expect(Array.isArray(list)).toBe(true);
    const sorted = [...list].sort();
    expect(list).toEqual(sorted);
  });
});
