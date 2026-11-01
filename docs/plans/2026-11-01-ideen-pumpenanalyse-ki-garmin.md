# Ideen: Pumpen-Analyse, KI-Umbau, Garmin-Daten

Stand: 2026-11-01. Sammlung zum Nachdenken, keine beschlossenen Aufgaben. Umgesetzt wird aktuell nur die Aufteilung in die Tabs "Pumpen-Analyse" und "KI-Auswertung" (siehe `2026-11-01-pump-analysis-tab-split.md`).

## 1. Ausbau der Pumpen-Analyse (deterministisch, ohne LLM)

- **Kontext vor dem Eingriff:** pro Stunde zeigen, wie der BZ-Trend in den 30 bis 60 Minuten vor einer Pumpenaktion (Temp-Basal hoch/runter, Auto-Bolus) aussah. Damit wird sichtbar, ob die Pumpe auf Anstiege reagiert oder dauerhaft ein zu niedriges/zu hohes Basal ausgleicht.
- **Basal-Kandidaten:** aus Basal-Delta und Hotspots konkrete Hinweise ableiten, z. B. "zwischen 4 und 6 Uhr hat die Pumpe an 9 von 12 Tagen im Schnitt 0,3 IE/h mehr abgegeben als geplant". Bewusst als Beobachtung formulieren, nicht als Therapieempfehlung.
- **Werktag vs. Wochenende:** Hotspots und Episoden getrennt auswerten.
- **Zeitraumvergleich:** zwei Zeiträume nebeneinander, z. B. vor und nach einer Profiländerung.
- **Faktoren-Plausibilität:** aus Korrektur-Boli und dem BZ-Verlauf danach grob prüfen, ob Korrekturfaktor (ISF) und KE-Faktor zum tatsächlichen Verhalten passen.
- **Mahlzeiten-Timing:** Auto-Boli kurz nach Mahlzeiten als Hinweis auf zu späten oder zu kleinen Mahlzeitenbolus.
- **Performance:** falls lange Zeiträume spürbar bremsen, Berechnung erst beim ersten Öffnen des Tabs (Eingriff in die Tab-Umschaltung von `lib/report/reportclient.js`).

## 2. KI-Umbau (z. B. Anthropic statt OpenAI)

- Grundlage ist vorhanden: `lib/ai/index.js` erkennt den Provider an der URL oder über `AI_LLM_PROVIDER`, `lib/ai/providers/anthropic.js` existiert bereits.
- Schwachstelle: Bei Anthropic wird das JSON-Schema nur als Text an den System-Prompt gehängt (`anthropic.js`, Abschnitt zu `response_format`), nicht erzwungen. Besser: Tool-Use bzw. Structured Output, damit die Antwort zuverlässig dem Schema folgt.
- Inhaltlich: die KI eher als Erklärer der deterministischen Ergebnisse einsetzen (Hotspots, Basal-Delta, Episoden), statt sie selbst Muster aus Rohdaten suchen zu lassen. Das senkt Tokens und Halluzinationen.
- Die Community übernimmt das Feature nicht; Freiheit bei Architektur und Provider.

## 3. Garmin Health- und Trainingsdaten

Weitgehend deterministisch auswertbar, ein LLM wäre nur optional für eine sprachliche Zusammenfassung nötig:

- BZ-Verlauf während und nach Aktivitäten, gruppiert nach Intensität bzw. Herzfrequenzzone
- Hypo-Häufigkeit in den 24 Stunden nach Sport, besonders nachts (verzögerte Hypos)
- Zeit im Zielbereich an Trainingstagen vs. Ruhetagen
- Schlafqualität vs. Morgen-BZ / Dawn-Phänomen
- Garmin-Stresswert und Body Battery vs. BZ-Niveau
- Schritte pro Stunde vs. BZ-Trend

Einstieg: Garmin Personal API (eigener API-Key für die eigenen Daten): https://developer.garmin.com/gc-developer-program/personal/personal-api/

Grenzen: kleine Fallzahlen und Störfaktoren (Essen, angepasste Basalraten, temporäre Ziele). Ergebnisse sind Korrelationen, keine Ursachen. Technisch offen: Zugang zur Garmin API (Konditionen, Rate Limits), Speicherung der Daten (eigene Collection oder Nightscout `activity`), Datenschutz.
