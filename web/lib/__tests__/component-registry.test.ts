import { describe, expect, it } from "vitest";

import {
  registerComponent,
  registeredComponents,
  resolveComponent,
} from "../component-registry";

describe("ComponentRegistry", () => {
  it("registers and resolves components by name", () => {
    const Stub = () => null;
    registerComponent("ProtoCard", Stub);
    expect(resolveComponent("ProtoCard")).toBe(Stub);
    expect(registeredComponents()).toContain("ProtoCard");
  });

  it("rejects duplicate registration", () => {
    const Stub = () => null;
    registerComponent("DupCard", Stub);
    expect(() => registerComponent("DupCard", Stub)).toThrow(/duplicate/);
  });

  it("returns undefined for missing names", () => {
    expect(resolveComponent("does-not-exist")).toBeUndefined();
  });
});
