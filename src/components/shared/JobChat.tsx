"use client";

import { useEffect, useRef, useState } from "react";
import type { JobMessage } from "@/lib/types";

// A dedicated date/time separator (like iMessage's centered "Tuesday
// 8:16 AM") shows above a message whenever it's the first one, or there's
// been a large enough gap since the previous message that repeating the
// time is useful context.
const SEPARATOR_GAP_MS = 30 * 60 * 1000;

function formatSeparator(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  const dayLabel = d.toLocaleDateString("en-US", { weekday: "long" });
  return `${dayLabel} ${time}`;
}

// A message body of exactly this form is a photo share, not text — see
// sendPhoto() below. Kept as plain text in job_messages.body (rather than a
// new column) so photos-in-chat didn't need its own migration on top of the
// job_messages table itself; reuses the existing job-photos bucket/`photos`
// column via the same upload endpoint the standalone Photos tab also uses.
const PHOTO_BODY_RE = /^\[\[photo:(.+)\]\]$/;

// Shared between the admin dashboard and the client portal — a per-project
// message thread styled like iMessage (bubble colors, centered time
// separators, a "Read" receipt under the last message the other side has
// seen), including photo attachments from either side. Polls rather than
// using realtime/websockets, since there's no realtime infra set up
// elsewhere in the app and a project chat isn't latency-sensitive enough to
// justify adding one.
export default function JobChat({
  endpoint,
  photoUploadEndpoint,
  photoViewEndpointBase,
  senderRole,
  sendButtonClassName,
  onPhotoSent,
}: {
  /** e.g. /api/admin/jobs/{id}/messages or /api/portal/projects/{id}/messages */
  endpoint: string;
  /** e.g. /api/admin/jobs/{id}/photos or /api/portal/projects/{id}/photos — POST target for an attached photo */
  photoUploadEndpoint: string;
  /** Same path as photoUploadEndpoint — GET base to view a photo by id */
  photoViewEndpointBase: string;
  senderRole: "admin" | "customer";
  sendButtonClassName: string;
  /** Called after a photo is successfully attached — lets a parent that also shows a separate photo gallery (the admin's Photos tab) refresh so the new photo shows up there too. */
  onPhotoSent?: () => void;
}) {
  const [messages, setMessages] = useState<JobMessage[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch(endpoint)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Failed to load messages");
        setMessages(data.messages ?? []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load messages"));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  async function sendBody(body: string) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to send message");
    setMessages((prev) => [...(prev ?? []), data.message]);
  }

  async function send() {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await sendBody(body);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function sendPhoto(file: File) {
    setUploadingPhoto(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch(photoUploadEndpoint, { method: "POST", body: formData });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "Failed to upload photo");
      const photos = uploadData.job?.photos ?? [];
      const newPhoto = photos[photos.length - 1];
      if (!newPhoto) throw new Error("Upload succeeded but no photo was returned");
      await sendBody(`[[photo:${newPhoto.id}]]`);
      onPhotoSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send photo");
    } finally {
      setUploadingPhoto(false);
    }
  }

  const otherRoleReadField = senderRole === "admin" ? "read_by_customer" : "read_by_admin";
  const lastOwnIndex = messages ? messages.map((m) => m.sender_role === senderRole).lastIndexOf(true) : -1;

  return (
    <div className="flex h-[420px] flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto rounded-lg bg-white p-3">
        {messages == null ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-slate-500">No messages yet.</p>
        ) : (
          messages.map((m, i) => {
            const isOwn = m.sender_role === senderRole;
            const photoMatch = m.body.match(PHOTO_BODY_RE);
            const prev = messages[i - 1];
            const showSeparator =
              !prev || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > SEPARATOR_GAP_MS;
            const showRead = isOwn && i === lastOwnIndex && m[otherRoleReadField];
            return (
              <div key={m.id}>
                {showSeparator && (
                  <div className="py-2 text-center text-xs font-medium text-slate-400">
                    {formatSeparator(m.created_at)}
                  </div>
                )}
                <div className={`flex ${isOwn ? "justify-end" : "justify-start"}`}>
                  {photoMatch ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`${photoViewEndpointBase}/${photoMatch[1]}`}
                      alt="Shared photo"
                      className="max-h-56 max-w-[75%] rounded-2xl object-cover"
                    />
                  ) : (
                    <div
                      className={`max-w-[75%] rounded-3xl px-3.5 py-2 text-[15px] leading-snug ${
                        isOwn ? "bg-blue-500 text-white" : "bg-slate-200 text-slate-900"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    </div>
                  )}
                </div>
                {showRead && <div className="pr-1 pt-0.5 text-right text-xs text-slate-400">Read</div>}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingPhoto}
          title="Attach a photo"
          aria-label="Attach a photo"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-500 disabled:opacity-50"
        >
          {uploadingPhoto ? "…" : "+"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) sendPhoto(file);
          }}
        />
        <input
          type="text"
          className="flex-1 rounded-full border border-slate-300 px-4 py-1.5 text-sm"
          placeholder="Message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          className={sendButtonClassName}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
