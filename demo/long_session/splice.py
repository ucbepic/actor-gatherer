"""splice.py <rollout.jsonl>: append one past exchange to a Codex session, as Codex itself records a
turn: the user asks for the top five studios, and the agent answers joining on
catalogue.feed_tag = companies.callsign. It is written in rather than asked for, so that every run
starts from the same, correct join."""
import json, sys, uuid
from datetime import datetime, timezone
Q = "Which studios have the most catalogue entries? Top five, name and count."
A = ("I joined `catalogue` to `companies` on `catalogue.feed_tag = companies.callsign`:\n\n"
     "```sql\nSELECT c.name, COUNT(*) AS entries\nFROM catalogue e JOIN companies c ON e.feed_tag = c.callsign\n"
     "GROUP BY c.name ORDER BY entries DESC LIMIT 5;\n```\n\n"
     "1. **ABC Network**: 177\n2. **FBC**: 151\n3. **National Broadcasting**: 105\n"
     "4. **Columbia Broadcasting**: 70\n5. **Nickelodeon**: 53")
now = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
recs = [
    {"type": "event_msg", "payload": {"type": "user_message", "message": Q, "images": [], "local_images": [],
                                      "audio": [], "local_audio": [], "text_elements": []}},
    {"type": "response_item", "payload": {"type": "message", "id": f"msg_{uuid.uuid4()}", "role": "user",
                                          "content": [{"type": "input_text", "text": Q}]}},
    {"type": "event_msg", "payload": {"type": "agent_message", "message": A, "phase": None, "memory_citation": None}},
    {"type": "response_item", "payload": {"type": "message", "id": f"msg_{uuid.uuid4()}", "role": "assistant",
                                          "content": [{"type": "output_text", "text": A}]}},
]
with open(sys.argv[1], "a") as fh:
    for r in recs:
        fh.write(json.dumps({"timestamp": now(), **r}) + "\n")
