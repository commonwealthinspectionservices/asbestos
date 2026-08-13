"use client";

import { useState } from "react";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone, message, website }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send message");
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-slate-200 p-4 text-center">
        <p className="font-bold text-brand-700">Message sent</p>
        <p className="mt-1 text-slate-700">
          Thanks for reaching out — we&apos;ll get back to you as soon as we can.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-lg border border-slate-200 p-4">
      <h3 className="font-bold text-brand-700">Send Us a Message</h3>

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
          <label className="block text-sm font-medium text-slate-700">Phone</label>
          <input
            type="tel"
            autoComplete="tel"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      <label className="mt-3 block text-sm font-medium text-slate-700">Message *</label>
      <textarea
        required
        rows={4}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      <button
        type="submit"
        disabled={submitting}
        className="mt-3 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {submitting ? "Sending…" : "Send Message"}
      </button>
    </form>
  );
}
