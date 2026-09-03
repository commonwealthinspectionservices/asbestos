"use client";

import { useRef, useState } from "react";
import type { JobPhoto } from "@/lib/types";

// Shared between the admin dashboard and the client portal — a drag-and-
// drop photo gallery for a single project. Either side can upload; only
// the admin can delete (deleteEndpoint is omitted on the portal side).
export default function JobPhotos({
  photos,
  uploadEndpoint,
  viewEndpointBase,
  deleteEndpointBase,
  editEndpointBase,
  onChanged,
  uploadButtonClassName,
}: {
  photos: JobPhoto[];
  /** POST target for a new upload, e.g. /api/admin/jobs/{id}/photos */
  uploadEndpoint: string;
  /** GET base to view a photo by id, e.g. /api/admin/jobs/{id}/photos */
  viewEndpointBase: string;
  /** DELETE base by id, e.g. /api/admin/jobs/{id}/photos — omit to hide delete (portal side) */
  deleteEndpointBase?: string;
  /** PATCH base by id, e.g. /api/admin/jobs/{id}/photos — Room/Note fields
      for the Moisture Mapping report (report-pdf.tsx). Omit to hide those
      fields entirely — every other job's Photos tab stays a plain gallery,
      and the portal side never gets this at all. */
  editEndpointBase?: string;
  onChanged: () => void;
  uploadButtonClassName: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Local draft per photo so typing doesn't fight the `photos` prop (which
  // only reflects the last save) — keyed by photo id, seeded from the
  // photo's own current value the first time it's touched.
  const [drafts, setDrafts] = useState<Record<string, { room?: string; caption?: string }>>({});

  async function savePhotoField(photoId: string, patch: { room?: string; caption?: string }) {
    if (!editEndpointBase) return;
    try {
      await fetch(`${editEndpointBase}/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      onChanged();
    } catch {
      setError("Failed to save");
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of imageFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(uploadEndpoint, { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to upload photo");
      }
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload photo");
    } finally {
      setUploading(false);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!deleteEndpointBase) return;
    setError(null);
    try {
      const res = await fetch(`${deleteEndpointBase}/${photoId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to delete photo");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete photo");
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center ${
          dragOver ? "border-brand-600 bg-brand-50" : "border-slate-300"
        }`}
      >
        <p className="text-sm text-slate-500">Drag and drop photos here, or</p>
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className={uploadButtonClassName}>
          {uploading ? "Uploading…" : "Choose photos"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
      </div>

      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {photos.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No photos yet.</p>
      ) : editEndpointBase ? (
        // Per Tim, 2026-09-03 — Moisture Mapping: Room groups photos into
        // headings on the report, Note prints underneath each photo. Only
        // ever rendered when editEndpointBase is passed in (JobsDashboard.tsx
        // gates that on the job actually having this service type) — every
        // other job keeps the plain bare-thumbnail grid below.
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((photo, index) => {
            const draft = drafts[photo.id];
            const room = draft?.room ?? photo.room ?? "";
            const caption = draft?.caption ?? photo.caption ?? "";
            return (
              <div key={photo.id} className="group relative overflow-hidden rounded-lg border border-slate-200">
                <div className="relative aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`${viewEndpointBase}/${photo.id}`}
                    alt={photo.file_name}
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white">
                    Photo {index + 1}
                  </span>
                  {deleteEndpointBase && (
                    <button
                      onClick={() => deletePhoto(photo.id)}
                      className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white group-hover:block"
                      aria-label="Delete photo"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="space-y-1 p-1.5">
                  <input
                    type="text"
                    placeholder="Room / area"
                    value={room}
                    onChange={(e) => setDrafts((d) => ({ ...d, [photo.id]: { ...d[photo.id], room: e.target.value } }))}
                    onBlur={(e) => savePhotoField(photo.id, { room: e.target.value })}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Note"
                    value={caption}
                    onChange={(e) => setDrafts((d) => ({ ...d, [photo.id]: { ...d[photo.id], caption: e.target.value } }))}
                    onBlur={(e) => savePhotoField(photo.id, { caption: e.target.value })}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${viewEndpointBase}/${photo.id}`}
                alt={photo.file_name}
                className="h-full w-full object-cover"
              />
              {deleteEndpointBase && (
                <button
                  onClick={() => deletePhoto(photo.id)}
                  className="absolute right-1 top-1 hidden rounded-full bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white group-hover:block"
                  aria-label="Delete photo"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
