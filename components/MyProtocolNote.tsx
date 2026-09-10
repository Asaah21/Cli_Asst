"use client";

import { useEffect, useState } from "react";

export default function MyProtocolNote({ condition }: { condition: string }) {
  const [loaded, setLoaded] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(`/api/protocols?condition=${encodeURIComponent(condition)}`);
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.note) {
          setNoteId(data.note.id);
          setText(data.note.note);
          setDraft(data.note.note);
        }
      } catch {
        // Best-effort — personal notes are a convenience, not core functionality.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [condition]);

  async function save() {
    if (!draft.trim()) return;

    setSaving(true);
    setError("");

    try {
      const res = await fetch("/api/protocols", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: noteId ?? undefined, condition, note: draft }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save note.");

      setNoteId(data.note.id);
      setText(data.note.note);
      setEditing(false);
    } catch (err: any) {
      setError(err.message || "Failed to save note.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!noteId) {
      setText("");
      setDraft("");
      setEditing(false);
      return;
    }

    setSaving(true);

    try {
      await fetch(`/api/protocols?id=${noteId}`, { method: "DELETE" });
      setNoteId(null);
      setText("");
      setDraft("");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return <p className="muted">Loading your notes...</p>;
  }

  return (
    <div className="myProtocolBlock">
      <p className="muted myProtocolTag">
        Your own off-guideline practice note for this condition — never AI-generated, never shown to anyone else, and not treated as a recommendation by this app.
      </p>

      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write your own protocol/notes for this condition..."
          />
          {error && <div className="errorBox">{error}</div>}
          <div className="myProtocolActions">
            <button className="primaryButton smallButton" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save note"}
            </button>
            <button
              className="secondaryButton smallButton"
              onClick={() => {
                setDraft(text);
                setEditing(false);
                setError("");
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </>
      ) : text ? (
        <>
          <p className="myProtocolText">{text}</p>
          <div className="myProtocolActions">
            <button className="textButton" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="textButton" onClick={remove} disabled={saving}>
              {saving ? "Removing..." : "Delete"}
            </button>
          </div>
        </>
      ) : (
        <button className="secondaryButton smallButton" onClick={() => setEditing(true)}>
          + Add my protocol note
        </button>
      )}
    </div>
  );
}
