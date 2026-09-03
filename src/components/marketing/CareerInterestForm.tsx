"use client";

import { useState } from "react";

const MAX_RESUME_BYTES = 8 * 1024 * 1024; // 8MB

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — server just needs the raw base64.
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function CareerInterestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [isFirefighter, setIsFirefighter] = useState(false);
  const [firefighterDepartment, setFirefighterDepartment] = useState("");
  const [availabilityNotes, setAvailabilityNotes] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleResumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_RESUME_BYTES) {
      setError("That resume is too large (8MB max) — try a smaller file.");
      e.target.value = "";
      setResumeFile(null);
      return;
    }
    setError(null);
    setResumeFile(file);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const resume = resumeFile
        ? { resumeFilename: resumeFile.name, resumeBase64: await readFileAsBase64(resumeFile) }
        : {};
      const res = await fetch("/api/careers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          location,
          isFirefighter,
          firefighterDepartment,
          availabilityNotes,
          extraNotes,
          website,
          ...resume,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send your info");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send your info");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 text-center">
        <p className="font-bold text-brand-700">Thanks — you&apos;re on the list</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4">
      <h3 className="font-bold text-brand-700">I&apos;m Interested</h3>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {/* Hidden from real visitors — a filled value means a bot. */}
      <input
        type="text"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        className="hidden"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      <label className="mt-3 block text-sm font-medium text-slate-700">Name *</label>
      <input
        required
        autoComplete="name"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="mt-3 flex gap-2">
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-700">Email *</label>
          <input
            required
            type="email"
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-slate-700">Phone *</label>
          <input
            required
            type="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-slate-700">Where are you based?</label>
      <p className="mt-0.5 text-xs text-slate-500">City/town is fine — helps us figure out what&apos;s actually reachable for you.</p>
      <input
        autoComplete="address-level2"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />

      <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={isFirefighter}
          onChange={(e) => setIsFirefighter(e.target.checked)}
        />
        I&apos;m a firefighter
      </label>

      {isFirefighter && (
        <>
          <label className="mt-3 block text-sm font-medium text-slate-700">Which department?</label>
          <input
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={firefighterDepartment}
            onChange={(e) => setFirefighterDepartment(e.target.value)}
          />
        </>
      )}

      <label className="mt-3 block text-sm font-medium text-slate-700">
        Tell us about your schedule / availability
      </label>
      <p className="mt-0.5 text-xs text-slate-500">
        Shift rotation, days off, how much time you&apos;d realistically have — whatever&apos;s
        easiest for you to describe in your own words.
      </p>
      <textarea
        rows={4}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={availabilityNotes}
        onChange={(e) => setAvailabilityNotes(e.target.value)}
      />

      <label className="mt-3 block text-sm font-medium text-slate-700">Resume (optional)</label>
      <input
        type="file"
        accept=".pdf,.doc,.docx"
        onChange={handleResumeChange}
        className="mt-1 w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700"
      />

      <label className="mt-3 block text-sm font-medium text-slate-700">Anything else you want to mention?</label>
      <textarea
        rows={3}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={extraNotes}
        onChange={(e) => setExtraNotes(e.target.value)}
      />

      <button
        type="submit"
        disabled={submitting}
        className="mt-4 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Submit Interest"}
      </button>
    </form>
  );
}
