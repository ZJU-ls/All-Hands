"use client";

import { useEffect, useState } from "react";

const BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000")
  : "http://localhost:8000";

type Provider = {
  id: string;
  name: string;
  base_url: string;
  api_key_set: boolean;
  default_model: string;
  is_default: boolean;
  enabled: boolean;
};

async function fetchProviders(): Promise<Provider[]> {
  const res = await fetch(`${BASE}/api/providers`);
  if (!res.ok) return [];
  return res.json() as Promise<Provider[]>;
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    base_url: "https://api.openai.com/v1",
    api_key: "",
    default_model: "gpt-4o-mini",
    set_as_default: false,
  });
  const [saving, setSaving] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const load = async () => {
    setProviders(await fetchProviders());
  };

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/providers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setShowForm(false);
      setForm({ name: "", base_url: "https://api.openai.com/v1", api_key: "", default_model: "gpt-4o-mini", set_as_default: false });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(id: string) {
    await fetch(`${BASE}/api/providers/${id}/set-default`, { method: "POST" });
    await load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this provider?")) return;
    await fetch(`${BASE}/api/providers/${id}`, { method: "DELETE" });
    await load();
  }

  async function handleTest(id: string) {
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, msg: "Testing\u2026" } }));
    const res = await fetch(`${BASE}/api/providers/${id}/test`, { method: "POST" });
    const data = (await res.json()) as { ok: boolean; error?: string; response?: string };
    setTestResults((prev) => ({
      ...prev,
      [id]: { ok: data.ok, msg: data.ok ? (data.response ?? "OK") : (data.error ?? "failed") },
    }));
  }

  return (
    <div className="flex h-full w-full">
      {/* Sidebar */}
      <div className="w-56 shrink-0 border-r border-zinc-800 flex flex-col p-3 gap-1">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1 mb-2">
          allhands
        </div>
        <a href="/chat" className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1.5 rounded hover:bg-zinc-800 transition-colors">
          &larr; Chat
        </a>
        <div className="text-xs text-zinc-300 bg-zinc-800 px-2 py-1.5 rounded">
          LLM Providers
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-lg font-semibold text-zinc-100">LLM Providers</h1>
            <button
              onClick={() => setShowForm(true)}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 px-3 py-1.5 text-sm font-medium transition-colors"
            >
              + Add Provider
            </button>
          </div>

          {providers.length === 0 && !showForm && (
            <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center">
              <p className="text-zinc-500 text-sm mb-3">No providers configured.</p>
              <p className="text-zinc-600 text-xs">Add an OpenAI-compatible provider to start chatting.</p>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {providers.map((p) => (
              <div key={p.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm text-zinc-100">{p.name}</span>
                      {p.is_default && (
                        <span className="text-[10px] bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-medium">
                          DEFAULT
                        </span>
                      )}
                      {!p.enabled && (
                        <span className="text-[10px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded">
                          DISABLED
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 font-mono truncate">{p.base_url}</p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Model: <span className="text-zinc-400">{p.default_model}</span>
                      {" \u00b7 "}
                      Key: <span className={p.api_key_set ? "text-green-500" : "text-zinc-500"}>
                        {p.api_key_set ? "set" : "not set"}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => void handleTest(p.id)}
                      className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700 hover:border-zinc-600 transition-colors"
                    >
                      Test
                    </button>
                    {!p.is_default && (
                      <button
                        onClick={() => void handleSetDefault(p.id)}
                        className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded border border-zinc-700 hover:border-zinc-600 transition-colors"
                      >
                        Set Default
                      </button>
                    )}
                    <button
                      onClick={() => void handleDelete(p.id)}
                      className="text-xs text-red-500 hover:text-red-400 px-2 py-1 rounded border border-zinc-700 hover:border-red-900 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {testResults[p.id] && (
                  <div className={`mt-2 text-xs px-3 py-1.5 rounded ${testResults[p.id].ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {testResults[p.id].msg}
                  </div>
                )}
              </div>
            ))}
          </div>

          {showForm && (
            <div className="mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-4">Add LLM Provider</h2>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Name</label>
                  <input
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    placeholder="e.g. OpenAI, DeepSeek, Local Ollama"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Base URL</label>
                  <input
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    placeholder="https://api.openai.com/v1"
                    value={form.base_url}
                    onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">API Key</label>
                  <input
                    type="password"
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    placeholder="sk-... (leave empty for local providers)"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Default Model</label>
                  <input
                    className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 font-mono placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
                    placeholder="gpt-4o-mini"
                    value={form.default_model}
                    onChange={(e) => setForm({ ...form, default_model: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={form.set_as_default}
                    onChange={(e) => setForm({ ...form, set_as_default: e.target.checked })}
                  />
                  <span className="text-xs text-zinc-400">Set as default provider</span>
                </label>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={() => void handleCreate()}
                    disabled={saving || !form.name || !form.base_url}
                    className="rounded-lg bg-zinc-600 hover:bg-zinc-500 disabled:opacity-40 px-4 py-2 text-sm font-medium transition-colors"
                  >
                    {saving ? "Saving\u2026" : "Save"}
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
