import { describe, expect, it } from "vitest";
import { classifyToolId, shortToolName } from "../tool-kind";

describe("classifyToolId", () => {
  it.each([
    ["allhands.meta.list_providers", "system"],
    ["allhands.meta.create_employee", "system"],
    ["allhands.builtin.fetch_url", "system"],
    ["allhands.render.markdown_card", "system"],
    ["allhands.skill.resolve_skill", "system"],
    ["allhands.subagent.spawn", "system"],
    ["allhands.stock.market_summary", "system"],
    ["allhands.new_prefix_that_doesnt_exist_yet", "system"], // fallback: any allhands.* = ours
  ] as const)("%s classifies as system", (id, expected) => {
    expect(classifyToolId(id)).toBe(expected);
  });

  it.each([
    ["mcp.Filesystem.read_file", "external"],
    ["mcp.slack.post_message", "external"],
    ["some.random.tool", "external"],
    ["github.create_issue", "external"],
  ] as const)("%s classifies as external", (id, expected) => {
    expect(classifyToolId(id)).toBe(expected);
  });
});

describe("shortToolName", () => {
  it.each([
    ["allhands.meta.list_providers", "list_providers"],
    ["mcp.Filesystem.read_file", "read_file"],
    ["single_segment", "single_segment"],
    ["", ""],
  ] as const)("%s → %s", (id, expected) => {
    expect(shortToolName(id)).toBe(expected);
  });
});
