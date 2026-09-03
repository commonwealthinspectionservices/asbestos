"use client";

import { useRef, useState, type ReactNode } from "react";
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
  headerExtra,
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
  /** Per Tim, 2026-09-04 — "all these buttons should be on one line
      straight across": room-editor mode only, rendered at the left of the
      same row as "Choose photos"/"+ Add room" — the Moisture Mapping tab's
      "Download Report" link lives here instead of sitting on its own line
      above, via JobsDashboard.tsx. */
  headerExtra?: ReactNode;
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
  const [addingRoom, setAddingRoom] = useState(false);
  const [editingBucket, setEditingBucket] = useState<string | null>(null);
  // Per Tim, 2026-09-04 — "click onto them to make them bigger": a plain
  // full-screen preview, not a full carousel — click a thumbnail, click
  // anywhere (or the ✕) to dismiss.
  const [previewPhoto, setPreviewPhoto] = useState<JobPhoto | null>(null);

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

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => e.target.files && uploadFiles(e.target.files)}
    />
  );

  return (
    <div>
      {editEndpointBase ? (
        // Per Tim, 2026-09-04 (follow-up: "this is not needed to be big it
        // should just be a small button next to add room") — the full
        // dropzone below is the right size for the plain gallery, but once
        // the room editor's own "+ Add room" control exists up top, a big
        // dashed box was redundant weight; a plain small button living next
        // to it (see the room-editor return below) covers the same upload
        // action.
        fileInput
      ) : (
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
          {fileInput}
        </div>
      )}

      {error && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {editEndpointBase ? (
        // Per Tim, 2026-09-03/2026-09-04/2026-09-04 (follow-up: "one line
        // across each... MUST fill out the whole screen"; then "vertical
        // list where you can drag and drop the rows under different room
        // titles"; then "not needed to be big it should just be a small
        // button next to add room") — Moisture Mapping: each room is a
        // full-width row (not a narrow column, which left most of the
        // screen empty), photos inside a room stack as their own draggable
        // list rows rather than grid cards, and dragging one onto a room
        // reassigns it (report-pdf.tsx groups photos under these as
        // headings). Upload lives as a small button next to "+ Add room"
        // instead of the big dropzone below — both work regardless of
        // whether any photos exist yet. An "Unassigned" row always holds
        // anything not yet sorted and can't be deleted. Only ever rendered
        // when editEndpointBase is passed in (JobsDashboard.tsx gates that
        // on the job actually having this service type) — every other job
        // keeps the plain bare-thumbnail grid below.
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
            setAddingRoom(false);
          }

          // Deleting a room just drops its photos back to Unassigned rather
          // than the room itself owning any state of its own to clean up —
          // a room only ever exists as either a pendingRooms entry or the
          // derived presence of at least one photo with that room value.
          function deleteRoom(bucket: string) {
            photos.filter((p) => roomOf(p) === bucket).forEach((p) => movePhotoToRoom(p.id, UNASSIGNED));
            setPendingRooms((r) => r.filter((x) => x !== bucket));
          }

          // Per Tim, 2026-09-04 — "where it says 'unassigned' needs to be
          // the room title": every room heading, including "Unassigned"
          // itself, is click-to-edit — typing a new name there bulk-moves
          // every photo currently in that bucket to the new room, which
          // doubles as the fast path for turning a pile of just-uploaded
          // photos into a named room without dragging them one at a time.
          // Blurring without changing anything is a no-op, so clicking in
          // and out of "Unassigned" can never accidentally rename it.
          function renameBucket(bucket: string, newNameRaw: string) {
            const newName = newNameRaw.trim();
            setEditingBucket(null);
            if (!newName || newName === bucket || bucketNames.includes(newName)) return;
            const affected = photos.filter((p) => (bucket === UNASSIGNED ? !roomOf(p) : roomOf(p) === bucket));
            affected.forEach((p) => movePhotoToRoom(p.id, newName));
            setPendingRooms((r) => {
              const withoutOld = r.filter((x) => x !== bucket);
              return affected.length === 0 ? [...withoutOld, newName] : withoutOld;
            });
          }

          return (
            <div className="mt-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>{headerExtra}</div>
                <div className="flex items-center gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="rounded border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                >
                  {uploading ? "Uploading…" : "Choose photos"}
                </button>
                {addingRoom ? (
                  <>
                    <input
                      autoFocus
                      type="text"
                      placeholder="e.g. Kitchen"
                      value={newRoomName}
                      onChange={(e) => setNewRoomName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPendingRoom();
                        if (e.key === "Escape") {
                          setAddingRoom(false);
                          setNewRoomName("");
                        }
                      }}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <button onClick={addPendingRoom} className="rounded bg-brand-700 px-3 py-1.5 text-sm font-bold text-white">
                      Add
                    </button>
                    <button
                      onClick={() => {
                        setAddingRoom(false);
                        setNewRoomName("");
                      }}
                      className="text-sm text-slate-400 hover:text-slate-600"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setAddingRoom(true)}
                    className="rounded border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                  >
                    + Add room
                  </button>
                )}
                </div>
              </div>

              {photos.length === 0 ? (
                <p className="text-sm text-slate-500">No photos yet.</p>
              ) : (
              <div className="flex flex-col gap-3">
                {bucketNames.map((bucket) => {
                  const bucketPhotos = photos.filter((photo) => (bucket === UNASSIGNED ? !roomOf(photo) : roomOf(photo) === bucket));
                  return (
                    <div
                      key={bucket}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const photoId = e.dataTransfer.getData("text/plain");
                        if (photoId) movePhotoToRoom(photoId, bucket);
                      }}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        {editingBucket === bucket ? (
                          <input
                            autoFocus
                            type="text"
                            defaultValue={bucket === UNASSIGNED ? "" : bucket}
                            placeholder={UNASSIGNED}
                            onBlur={(e) => renameBucket(bucket, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              if (e.key === "Escape") setEditingBucket(null);
                            }}
                            className="rounded border border-slate-300 px-2 py-0.5 text-sm font-bold text-slate-700"
                          />
                        ) : (
                          <h4
                            onClick={() => setEditingBucket(bucket)}
                            className="cursor-text rounded px-1 text-sm font-bold text-slate-700 hover:bg-slate-100"
                          >
                            {bucket}
                          </h4>
                        )}
                        {bucket !== UNASSIGNED && (
                          <button onClick={() => deleteRoom(bucket)} className="text-xs text-slate-400 hover:text-red-500">
                            Delete room
                          </button>
                        )}
                      </div>
                      {bucketPhotos.length === 0 ? (
                        <p className="text-xs text-slate-400">Drag photos here</p>
                      ) : (
                        // Per Tim, 2026-09-04 (follow-up: "vertical list where you
                        // can drag and drop the rows under different room
                        // titles") — each photo is its own full-width list row,
                        // not a grid card, stacked vertically within the room
                        // it belongs to.
                        <div className="flex flex-col gap-1.5">
                          {bucketPhotos.map((photo) => {
                            const number = photos.findIndex((p) => p.id === photo.id) + 1;
                            const caption = drafts[photo.id]?.caption ?? photo.caption ?? "";
                            return (
                              <div
                                key={photo.id}
                                className="group flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                              >
                                {/* Per Tim, 2026-09-04 (follow-up: "i cant view the
                                    images now it only allows me to drag") — draggable
                                    used to be set on the WHOLE row, which meant any
                                    click on the thumbnail below (even a stray pixel of
                                    mouse movement) was captured as a drag-start instead
                                    of a click, so the lightbox never got a chance to
                                    open. Scoping draggable to just this handle leaves
                                    the rest of the row free for normal clicks. */}
                                <span
                                  draggable
                                  onDragStart={(e) => e.dataTransfer.setData("text/plain", photo.id)}
                                  className="flex-shrink-0 cursor-move select-none text-slate-300"
                                  aria-hidden="true"
                                >
                                  ⠿
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setPreviewPhoto(photo)}
                                  className="relative h-20 w-32 flex-shrink-0 cursor-zoom-in"
                                  aria-label="View larger"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`${viewEndpointBase}/${photo.id}`}
                                    alt={photo.file_name}
                                    draggable={false}
                                    className="h-full w-full rounded object-cover"
                                  />
                                  <span className="absolute -left-1 -top-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-bold leading-none text-white">
                                    {number}
                                  </span>
                                </button>
                                <input
                                  type="text"
                                  placeholder="Note"
                                  value={caption}
                                  onChange={(e) => setDrafts((d) => ({ ...d, [photo.id]: { ...d[photo.id], caption: e.target.value } }))}
                                  onBlur={(e) => savePhotoField(photo.id, { caption: e.target.value })}
                                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                                {/* Select fallback for room reassignment — dragging is the
                                    primary interaction but doesn't work on touch devices,
                                    so this keeps sorting usable from a phone/tablet too. */}
                                <select
                                  value={bucket}
                                  onChange={(e) => movePhotoToRoom(photo.id, e.target.value)}
                                  className="w-32 flex-shrink-0 rounded border border-slate-300 px-1.5 py-1 text-xs"
                                >
                                  {bucketNames.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                                {deleteEndpointBase && (
                                  <button
                                    onClick={() => deletePhoto(photo.id)}
                                    className="hidden flex-shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-600 hover:bg-red-100 hover:text-red-600 group-hover:block"
                                    aria-label="Delete photo"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          );
        })()
      ) : photos.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No photos yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                onClick={() => setPreviewPhoto(photo)}
                className="h-full w-full cursor-zoom-in"
                aria-label="View larger"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${viewEndpointBase}/${photo.id}`}
                  alt={photo.file_name}
                  className="h-full w-full object-cover"
                />
              </button>
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

      {previewPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewPhoto(null)}
        >
          <button
            onClick={() => setPreviewPhoto(null)}
            className="absolute right-4 top-4 rounded-full bg-black/60 px-3 py-1.5 text-sm font-bold text-white"
            aria-label="Close"
          >
            ✕
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${viewEndpointBase}/${previewPhoto.id}`}
            alt={previewPhoto.file_name}
            className="max-h-full max-w-full rounded object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
