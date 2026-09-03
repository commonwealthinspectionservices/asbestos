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
  // Room buckets a user has created via "+ Add room" but hasn't dragged a
  // photo into yet — session-only, not persisted anywhere (nothing on the
  // job stores an empty room list). Once a photo lands in one, the bucket
  // also derives naturally from that photo's own room field, same as any
  // other bucket.
  const [pendingRooms, setPendingRooms] = useState<string[]>([]);
  const [newRoomName, setNewRoomName] = useState("");

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
        // Per Tim, 2026-09-03/2026-09-04 — Moisture Mapping: drag each photo
        // into the room bucket it belongs to (report-pdf.tsx groups photos
        // under these as headings); an "Unassigned" bucket holds anything
        // not yet sorted. Only ever rendered when editEndpointBase is passed
        // in (JobsDashboard.tsx gates that on the job actually having this
        // service type) — every other job keeps the plain bare-thumbnail
        // grid below.
        (() => {
          const UNASSIGNED = "Unassigned";
          const roomOf = (photo: JobPhoto) => (drafts[photo.id]?.room ?? photo.room ?? "").trim();
          const roomsFromPhotos: string[] = [];
          for (const photo of photos) {
            const room = roomOf(photo);
            if (room && !roomsFromPhotos.includes(room)) roomsFromPhotos.push(room);
          }
          const rooms = [...roomsFromPhotos, ...pendingRooms.filter((r) => !roomsFromPhotos.includes(r))];
          const bucketNames = [UNASSIGNED, ...rooms];

          function movePhotoToRoom(photoId: string, room: string) {
            const value = room === UNASSIGNED ? "" : room;
            setDrafts((d) => ({ ...d, [photoId]: { ...d[photoId], room: value } }));
            savePhotoField(photoId, { room: value });
          }

          function addPendingRoom() {
            const name = newRoomName.trim();
            if (!name || bucketNames.includes(name)) return;
            setPendingRooms((r) => [...r, name]);
            setNewRoomName("");
          }

          return (
            <div className="mt-4 flex flex-wrap gap-3">
              {bucketNames.map((bucket) => {
                const bucketPhotos = photos.filter((photo) => (bucket === UNASSIGNED ? !roomOf(photo) : roomOf(photo) === bucket));
                const isRemovablePending = bucket !== UNASSIGNED && bucketPhotos.length === 0 && pendingRooms.includes(bucket);
                return (
                  <div
                    key={bucket}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const photoId = e.dataTransfer.getData("text/plain");
                      if (photoId) movePhotoToRoom(photoId, bucket);
                    }}
                    className="w-full flex-shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-2 sm:w-56"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-700">{bucket}</h4>
                      {isRemovablePending && (
                        <button
                          onClick={() => setPendingRooms((r) => r.filter((x) => x !== bucket))}
                          className="text-xs text-slate-400 hover:text-red-500"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {bucketPhotos.length === 0 && (
                      <p className="text-xs text-slate-400">Drag photos here</p>
                    )}
                    <div className="space-y-2">
                      {bucketPhotos.map((photo) => {
                        const number = photos.findIndex((p) => p.id === photo.id) + 1;
                        const caption = drafts[photo.id]?.caption ?? photo.caption ?? "";
                        return (
                          <div
                            key={photo.id}
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("text/plain", photo.id)}
                            className="group cursor-move rounded-lg border border-slate-200 bg-white p-1.5"
                          >
                            <div className="relative aspect-square">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`${viewEndpointBase}/${photo.id}`}
                                alt={photo.file_name}
                                className="h-full w-full rounded object-cover"
                              />
                              <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-xs font-bold text-white">
                                Photo {number}
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
                            <textarea
                              placeholder="Note"
                              value={caption}
                              rows={2}
                              onChange={(e) => setDrafts((d) => ({ ...d, [photo.id]: { ...d[photo.id], caption: e.target.value } }))}
                              onBlur={(e) => savePhotoField(photo.id, { caption: e.target.value })}
                              className="mt-1 w-full resize-none rounded border border-slate-300 px-1.5 py-1 text-xs"
                            />
                            {/* Select fallback for room reassignment — dragging is the
                                primary interaction but doesn't work on touch devices,
                                so this keeps sorting usable from a phone/tablet too. */}
                            <select
                              value={bucket}
                              onChange={(e) => movePhotoToRoom(photo.id, e.target.value)}
                              className="mt-1 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                            >
                              {bucketNames.map((name) => (
                                <option key={name} value={name}>{name}</option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div className="w-full flex-shrink-0 rounded-lg border border-dashed border-slate-300 p-2 sm:w-56">
                <h4 className="mb-2 text-sm font-bold text-slate-500">Add room</h4>
                <div className="flex gap-1">
                  <input
                    type="text"
                    placeholder="e.g. Kitchen"
                    value={newRoomName}
                    onChange={(e) => setNewRoomName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addPendingRoom()}
                    className="w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                  />
                  <button onClick={addPendingRoom} className="rounded bg-slate-200 px-2 text-xs font-bold text-slate-700">
                    Add
                  </button>
                </div>
              </div>
            </div>
          );
        })()
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
