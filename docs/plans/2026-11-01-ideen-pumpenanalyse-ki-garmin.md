# Ideen: Pumpen-Analyse, KI-Umbau, Garmin-Daten

## 0. Offene technische Punkte (Stand 2026-11-01)

- **Cache-Buster für `bundle.app.js`:** Nach einem Deploy kann der Browser das alte Bundle aus dem Cache nehmen (am 2026-11-01 passiert: Pumpen-Tab erst nach Cache-Leeren sichtbar). Fix wie beim Uhr-Fix `a800ca16`: in `views/index.html`, `reportindex.html`, `adminindex.html`, `profileindex.html`, `foodindex.html` `bundle.app.js?v=<%= locals.cachebuster %>` laden. Der Service Worker muss nicht angepasst werden (er fängt nur URLs ab, die exakt auf `/bundle/js/bundle.app.js` enden); seine Offline-Kopie wird dann nicht mehr genutzt. Prüfen: jede Seite lokal laden (`npm run test-local` bzw. Dev-Server gegen In-Memory-DB), Skript-URL trägt `?v=`, Bundle wird ausgeliefert.
- **Browser-Check der Pumpen-Analyse automatisierbar machen:** Seed-Skript mit erfundenen CGM- und Pumpendaten (einige Wochen), Dev-Server gegen die In-Memory-MongoDB, dann Report mit und ohne `AI_LLM_KEY` im Browser prüfen.
- **Profil nach dem Enddatum:** `datastorage.profiles[0]` kann ein Profil sein, das erst nach dem gewählten Zeitraum gilt (`lib/report/reportclient.js`, `loadProfilesRangeNext` mit `unshift`). Betrifft die Basal-Abweichung.
- **Test-Hygiene:** In `tests/pump_analysis.test.js` ("replaces remaining chart skeletons when chart rendering throws") werden die werfenden Stubs auf den Chart-Funktionen nicht zurückgesetzt; in `finally` wiederherstellen.
- **Windows-only Testfehler:** `dependency-brace-expansion` und `food-editor-touch-scroll` erwarten `/` statt `\` in Pfaden, `dependency-postcss` darf unter Windows keinen Symlink anlegen (`EPERM`). In der CI (Linux) unkritisch.

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
