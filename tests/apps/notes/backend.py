"""The test app's backend (app.toml): `add` keeps a note as an event and tells the open panels; an agent attached is
told what the notepad holds."""
from app_kit import App, Instance, Response, ToolResult, context_stream


class NotesApp(App):
    def open(self, instance: Instance, args: dict) -> Instance:
        name = (instance.folder or "").rstrip("/").rsplit("/", 1)[-1]
        return Instance(**{**instance.to_dict(), "title": name or "Notes"})

    def call(self, instance, tool, args, caller):
        text = str(args.get("text") or "").strip()
        if tool != "add" or not text:
            return ToolResult.error("notes_add takes the note's `text`")
        self.host.insert(instance, [{"type": "notes.added", "payload": {"text": text},
                                     "properties": {"by": caller.channel or "user"}}])
        self.host.tell_panel(instance, {"said": f"kept: {text}"})
        return ToolResult.text(f"kept: {text}")

    def attached(self, instance, channel):
        notes = [e["payload"]["text"] for e in self.host.read(instance, ["notes.added"])]
        said = "The notepad is empty." if not notes else "The notepad holds: " + "; ".join(notes)
        self.host.insert(instance, [context_stream("Notes", "the notepad", said)], channel=channel)

    def request(self, instance, method, path, query, body):
        if path == "count" and instance is not None:
            return Response.json({"notes": len(self.host.read(instance, ["notes.added"]))})
        return Response(404, b"not found")
