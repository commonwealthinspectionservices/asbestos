"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/types";
import { splitAddress } from "@/lib/address";
import JobChat from "@/components/shared/JobChat";

// Mirrors ProjectsList.tsx's own copy — a job stops needing an active chat
// once it's paid or cancelled, so those don't clutter this hub.
const CLOSED_STATUSES = new Set(["paid", "cancelled"]);

const PORTAL_ACTION_BUTTON =
  "inline-flex h-[22px] items-center border-[3px] border-brand-700 bg-brand-50 px-4 pt-0.5 text-sm font-extrabold uppercase leading-none text-brand-700 hover:bg-yellow-100 disabled:opacity-50 sm:h-[29px]";

// One place to reach every open project's chat, instead of opening each
// project individually just to send a message — the projects themselves
// still each have their own thread (job_messages is per-job, not
// per-account), this is just a faster way in.
export default function PortalChatHub() {
  const [projects, setProjects] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/portal/projects")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load projects");
        const openProjects = (data.projects as Job[]).filter((p) => !CLOSED_STATUSES.has(p.status));
        setProjects(openProjects);
        setSelectedId((current) => current ?? openProjects[0]?.id ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load projects"));
  }, []);

  const selected = projects?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-sm font-bold uppercase text-brand-700">Chat</h1>

      {error && <div className="mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}

      {projects == null ? (
        <p className="mt-6 text-sm text-slate-500">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500">No open projects to chat about right now.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className="flex shrink-0 flex-row gap-2 overflow-x-auto sm:w-56 sm:flex-col sm:overflow-visible">
            {projects.map((p) => {
              const { street } = splitAddress(p.service_address);
              const isSelected = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-left text-sm sm:shrink ${
                    isSelected ? "border-brand-700 bg-brand-50 font-semibold text-brand-700" : "border-slate-200 text-slate-600 hover:border-brand-400"
                  }`}
                >
                  {p.project_number && (
                    <div className="whitespace-nowrap font-mono text-xs">{p.project_number}</div>
                  )}
                  <div className="whitespace-nowrap">{street}</div>
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1">
            {selected && (
              <JobChat
                key={selected.id}
                endpoint={`/api/portal/projects/${selected.id}/messages`}
                photoUploadEndpoint={`/api/portal/projects/${selected.id}/photos`}
                photoViewEndpointBase={`/api/portal/projects/${selected.id}/photos`}
                senderRole="customer"
                sendButtonClassName={PORTAL_ACTION_BUTTON}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
