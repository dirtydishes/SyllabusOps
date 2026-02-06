import { describe, expect, test } from "bun:test";
import { parseIcsEvents } from "./ics";

describe("parseIcsEvents", () => {
  test("parses timezone-based events and extracts zoom metadata", () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:abc-123
DTSTART;TZID=America/New_York:20260210T090000
DTEND;TZID=America/New_York:20260210T101500
SUMMARY:Biology Lecture
DESCRIPTION:Join Zoom Meeting\\nhttps://school.zoom.us/j/12345678901?pwd=xyz\\nMeeting ID: 123 456 78901\\nPasscode: foxhound
LOCATION:Room 202
END:VEVENT
END:VCALENDAR`;

    const events = parseIcsEvents(ics);
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.uid).toBe("abc-123");
    expect(ev.title).toBe("Biology Lecture");
    expect(ev.timezone).toBe("America/New_York");
    expect(ev.startsAt).toContain("2026-02-10T14:00:00.000Z");
    expect(ev.endsAt).toContain("2026-02-10T15:15:00.000Z");
    expect(ev.zoomJoinUrl).toContain("school.zoom.us");
    expect(ev.zoomMeetingId).toBe("12345678901");
    expect(ev.zoomPasscode).toBe("foxhound");
  });

  test("creates stable fallback uid and supports recurrence ids", () => {
    const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260211T173000Z
DTEND:20260211T183000Z
SUMMARY:No UID Event
END:VEVENT
BEGIN:VEVENT
UID:series-1
RECURRENCE-ID:20260212T173000Z
DTSTART:20260212T173000Z
DTEND:20260212T183000Z
SUMMARY:Series Override
END:VEVENT
END:VCALENDAR`;

    const events = parseIcsEvents(ics);
    expect(events).toHaveLength(2);
    expect(events[0]?.uid.startsWith("autogen-")).toBeTrue();
    expect(events[1]?.uid).toBe("series-1#20260212T173000Z");
  });
});
