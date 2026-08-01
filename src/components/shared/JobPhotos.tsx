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
  onChanged: () => void;
  uploadButtonClassName: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
