# Design: Pumpen-Analyse mit Empfehlungen

Stand: 2026-11-03. Status: freigegeben nach Brainstorming, Builder-Check und Plan-Prüfung (zwei Prüfer: Anforderungen, Code).

Mockup (lokal, nicht im Repo): `.superpowers/brainstorm/1389-1793707357/content/empfehlungen-v1.html`. Die Werte im Mockup sind geschätzt. Abschnitt 3 des Mockups (Prozent-Balken) und der Dawn-Grund in der ersten Karte gelten nicht mehr; maßgeblich ist dieses Dokument.

## 1. Ziel und Hintergrund

Die Pumpen-Analyse (`lib/report_plugins/pump_analysis.js`) zeigt heute gut, **wo** etwas auffällt (Hotspots, Basal-Abweichung, Episoden, Tagesmuster). Sie beantwortet aber nicht die eigentliche Frage des Nutzers: **Was muss ich anpassen, Basalrate oder Bolus (KH-Faktor, Korrekturfaktor), und um wie viel?**

Ziel: Die Seite rechnet aus den vorhandenen Daten (CGM, Behandlungen, Pumpen-Basal, Profil) deterministisch konkrete Vorschläge pro Tagesblock aus und begründet jeden Vorschlag mit nachprüfbaren Stichworten, z. B. "an 12/14 Tagen hat Control-IQ 02-06 Uhr Basal erhöht, im Schnitt +0,30 U/h". Ob ein Vorschlag befolgt wird, entscheidet der Nutzer.

Nutzerkontext: Tandem-Pumpe mit Control-IQ, Einheit mg/dl. Bolusrechner wird oft überschrieben ("Standard Bolus (Override)"). KH werden nicht bei jeder Mahlzeit eingetragen. Morgens gibt der Nutzer einen kleinen Dawn-Bolus (1-1,5 U, enthält ca. 6 g KH, meist ohne KH-Eintrag).

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- Empfehlungsbereich ganz oben: pro Tagesblock ein konkreter Vorschlag mit Zahlen, Vertrauensstufe, Gründen als Stichworten, Datenbasis.
- Kennzahlen verständlich: jede Kennzahl mit Zielwert und kurzer Erklärung (insbesondere CV und MAGE), dazu GMI.
- Neue Grafik "Mahlzeiten-Kurven".
- Kleinere Verbesserungen bestehender Grafiken und Behebung des Legenden-Fehlers.
- Alle Texte deutsch.

**Nicht-Ziele**
- Keine automatische Änderung an Pumpe oder Profil.
- Kein LLM. Alle Texte entstehen aus festen Regeln und Textbausteinen.
- Kein Umbau der Episodenzeiten-Grafik.
- Keine Prozent-Balken für die Basal-Abweichung (Nutzer bevorzugt das Liniendiagramm).
- Keine Einstellbarkeit per Umgebungsvariable in dieser Ausbaustufe (siehe 8.1).
- Kein Cache-Buster für `bundle.app.js` und keine Behebung der Windows-only-Testfehler (bleiben in `docs/plans/2026-11-01-ideen-pumpenanalyse-ki-garmin.md`, Abschnitt 0).
- Die KI-Auswertung (`ai_eval`) ändert sich nicht.

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)**
- Empfehlungen ohne nachvollziehbare Zahlen dahinter.
- Empfehlungen trotz zu dünner Datenbasis statt "zu wenig Daten".
- Vorschläge, die einem Gegensignal widersprechen, ohne darauf hinzuweisen.
- Große Sprünge (mehr als 20 % pro Schritt).

## 3. Konstanten

Alle Grenzwerte als benannte Konstanten in einem Modul (z. B. `pump_analysis/recommendation_rules.js`), intern immer in mg/dl:

| Konstante | Wert | Herkunft |
|---|---|---|
| Morgenfenster | 04:00-09:00 | Vorschlag, Nutzer bestätigt |
| Dawn-Bolus max. | 1,5 U | Nutzer |
| Dawn-Bolus max. KH-Eintrag | 10 g | meine Entscheidung (Sicherheitsnetz, falls doch 6 g eingetragen) |
| Korrektur-Schwelle | 240 mg/dl | Nutzer |
| "Schnell steigend" | ≥ +8 mg/dl pro 5 min (Anstieg zwischen zwei aufeinanderfolgenden CGM-Werten vor dem Bolus) | Nutzer |
| KH-Eintrag gehört zum Bolus | ±30 min | meine Entscheidung |
| Mahlzeiten-Slots | Frühstück 05-10, Mittag 10-15, Abend 17-22 Uhr | meine Entscheidung |
| Hypo | < 70 mg/dl für ≥ 15 min | an bestehende Episodenerkennung in `lib/statistics.js` angleichen; weicht sie ab, gilt die bestehende Definition |
| Hyper-Gegensignal | > 250 mg/dl für ≥ 15 min | meine Entscheidung (über 190 ist fast täglich, würde jede "weniger"-Empfehlung blockieren) |
| Richtungs-Schwelle / "Passt" | 10 % | Nutzer bestätigt |
| Max. Schritt | 20 % | Nutzer bestätigt |
| Rundung Basal | 0,05 U/h | Annahme Tandem-Schrittweite |
| Rundung KH-Faktor | 0,5 g/U | meine Entscheidung |
| Rundung Korrekturfaktor | 1 mg/dl/U | meine Entscheidung |
| Min. CGM-Abdeckung pro Auswertefenster | 80 % | meine Entscheidung |

## 4. Klassifizierung der Boli

Jeder Nutzer-Bolus (kein Control-IQ-Auto-Bolus; Erkennung über `isAutoBolusEvent` in `lib/statistics.js`) bekommt genau eine Klasse. Reihenfolge der Prüfung:

1. **Dawn-Bolus:** im Morgenfenster, ≤ 1,5 U, kein KH-Eintrag oder KH-Eintrag ≤ 10 g. Wird **ignoriert**: fließt in keine Berechnung ein, sein KH-Eintrag ebenfalls nicht. Wird nur gezählt.
2. **Mahlzeiten-Bolus:** KH-Eintrag am Bolus oder innerhalb ±30 min.
3. **Korrektur:** kein KH-Eintrag, BZ > 240 oder schnell steigend zum Bolus-Zeitpunkt.
4. **unklar:** sonst. Wird nicht ausgewertet, aber gezählt.

Ereignisse wie "Cannula Filled", "Tubing Filled", "UserAborted" sind keine Boli. Da `isBolusEvent` nur den `eventType` prüft (`lib/statistics.js:596-601`), braucht es eine Testfixture mit realen tconnectsync-Formen (eventType plus notes, insulin 0 und > 0), um das abzusichern.

## 5. Berechnungen

Neues Modul `lib/report_plugins/pump_analysis/recommendations.js`: rein funktional, kein DOM. Eingabe: Behandlungen, CGM-Werte pro Tag (`entriesByDay` aus `pump_analysis/data_processor.js`), Profil, Tagesstatistiken. Ausgabe: Liste von Empfehlungen (Block, Art, alter Wert, neuer Wert, Stufe, Gründe, Datenbasis) bzw. Warnkarten.

### 5.1 Basal pro Stunde

- **Fastenfenster:** eine Stunde an einem Tag, in deren 4 Stunden davor weder Mahlzeiten-Bolus, Korrektur, unklarer Bolus noch KH-Eintrag (außer ignorierte Dawn-Boli) lag, und mit ≥ 80 % CGM-Abdeckung. Ignorierte Dawn-Boli stören ein Fastenfenster nicht.
- **Fall** = ein Fastenfenster (Stunde × Tag). Basal-Empfehlungen stützen sich **nur** auf Fastenfenster.
- **Abweichung pro Fall** d = (geliefertes Basal netto + Auto-Boli + BZ-Drift/`sens`) / Profil-Basal - 1. Geliefertes Basal netto = Erhöhungen minus Rücknahmen/Unterbrechungen. Pro Tag über `integrateActualBasalByHour(treatments, profile, [dayKey])` (`lib/statistics.js`, so wie `detectHotspots` es tut), weil die bestehende Funktion sonst nur Mittelwerte über alle Tage liefert.
- **Auto-Boli und Dawn-Insulin** werden über 4 h ab Abgabe anteilig auf die Stunden verteilt (Wirkdauer), nicht nur der Abgabestunde zugerechnet. Auto-Boli zählen voll in d. Für Dawn-Insulin wird d zweimal gerechnet, ohne und mit dem anteiligen Dawn-Insulin; verwendet wird der Wert, der näher an 0 liegt (Ruling R22: der BZ-Abfall nach dem Dawn-Bolus darf nicht als "zu viel Basal" gelten, ein Weglassen der Fälle würde umgekehrt zu mehr Basal verzerren).
- **Richtung pro Fall:** hoch, wenn d ≥ +10 %, runter, wenn d ≤ -10 %, sonst neutral. Neutral zählt **gegen** "gleiche Richtung".
- **Vorschlag pro Stunde:** Median der d. "Passt", wenn |Median| < 10 %.
- **Blöcke:** benachbarte Stunden mit gleicher Richtung werden zusammengefasst. Fallzahl eines Blocks = Minimum der Fallzahlen seiner Stunden; Richtungsanteil = Anteil über alle Fälle des Blocks.
- **Vorverlegung:** Der Block wird um 1 Stunde nach vorne verlängert (02:00-06:00 → 01:00-06:00), außer diese Stunde hat die Gegenrichtung oder "zu wenig Daten". Über Mitternacht erlaubt (Block ab 00:00 beginnt dann 23:00).
- **Neue Rate:** pro Profilsegment im Block: Profilrate × (1 + Median-d des Blocks), begrenzt auf ±20 %, auf 0,05 U/h gerundet. Mehrere Profilraten im Block → mehrere Zeilen in derselben Karte.
- Ohne Pumpen-Basaldaten (`basal_source !== 'pump'`, `lib/statistics.js:1590`): Basal-Empfehlungen entfallen mit Hinweis.
- Fester Grund in jeder Basal-Karte im Morgenfenster, wenn Dawn-Boli vorkamen: "Dawn-Bolus an %1/%2 Tagen als Spanne berücksichtigt, Ø %3 U" (der Grund wird wie der Vorverlegungs-Hinweis nie gekürzt).

### 5.2 KH-Faktor pro Mahlzeiten-Slot

- **Fall** = Mahlzeiten-Bolus mit KH-Eintrag, ohne weitere Mahlzeit in den 4 h danach, mit ≥ 80 % CGM-Abdeckung.
- **Effektiver Faktor** = KH / (Mahlzeiten-Bolus + Korrekturen + Auto-Boli + Netto-Basalabweichung in den 4 h danach + Restkorrektur). Restkorrektur = (BZ nach 4 h - Startwert) / `sens`; positiv, wenn der BZ höher endet. Dawn-Insulin, das ins Fenster wirkt, zählt anteilig mit. Ist der Nenner ≤ 0, zählt der Fall mit d = -1 (Richtung "weniger Insulin"), ohne effektiven Faktor in den angezeigten Medianen; ein Verwerfen würde den Median zu mehr Insulin verzerren.
- KH-Faktor und `sens` aus dem Profil zur jeweiligen Uhrzeit: neue generische Zeitplan-Suche analog `buildProfileBasalLookup` (`lib/statistics.js:714-732`), die es für `carbratio`/`sens` noch nicht gibt.
- **Abweichung pro Fall** d = Profil-Faktor / effektiver Faktor - 1 (positiv = mehr Insulin nötig). Richtung, Median, "Passt", 20 %-Grenze wie 5.1. Rundung 0,5 g/U.
- **Muster "zu spät gespritzt":** Spitze ≥ Startwert + 80 mg/dl innerhalb von 90 min **und** Wert nach 4 h < Startwert an ≥ 60 % der Fälle → Karte "Spritz-Ess-Abstand prüfen" statt Faktor-Änderung.

### 5.3 Korrekturfaktor

- **Fall** = Korrektur bei BZ > 240, nicht schnell steigend, ohne KH, Bolus oder Hypo-Behandlung 3 h davor und danach, ≥ 80 % CGM-Abdeckung.
- Gemessener Abfall nach 3 h in mg/dl pro U (Auto-Boli und Basalabweichung im Fenster einrechnen), verglichen mit `sens` zur Uhrzeit. d = `sens` / gemessen - 1 (positiv = stärkerer Faktor nötig). Rest wie 5.1. Rundung 1 mg/dl/U. Dawn-Insulin im Fenster zählt anteilig mit. Korrekturen ohne BZ-Abfall entfallen; Korrekturen mit BZ-Abfall, aber Insulin ≤ 0 im Fenster, zählen mit d = -1.
- Korrekturen wegen schnellen Anstiegs zählen nur zur Korrekturmenge pro Tageszeit (Grund-Stichwort), nicht zur Messung.

### 5.4 Vertrauensstufe (Nutzer bestätigt)

- **hoch:** ≥ 7 Fälle, ≥ 75 % gleiche Richtung, kein Gegensignal
- **mittel:** ≥ 5 Fälle und ≥ 60 % gleiche Richtung
- **niedrig:** sonst (bei ≥ 5 Fällen)
- **zu wenig Daten:** < 5 Fälle. Kein Rückgriff auf alle Tage.

### 5.5 Gegensignale (zentrale Sicherheitsregel, Nutzer bestätigt)

- Bei "mehr Insulin": Hypo im Zeitraum. Bei "weniger Insulin": Hyper > 250 im Zeitraum.
- Zeitraum: Basal = Block inkl. vorverlegter Stunde; KH-Faktor = 4 h nach jeder Mahlzeit des Slots; Korrekturfaktor = 3 h nach jeder Korrektur. Geprüft werden alle Mahlzeiten bzw. Korrekturen, auch die für die Messung verworfenen (Ruling R21: gerade Mahlzeiten mit behandelter Hypo fallen sonst heraus).
- Quelle: `dayStats[i].hypo_episodes` / `hyper_episodes` (mit Start/Ende), nicht `computeEpisodesWithHours` (liefert nur Tageszahlen pro Stunde).
- **Schwach:** an 1-2 Tagen. Stufe eins niedriger (hoch → mittel → niedrig; niedrig bleibt niedrig). Gegensignal steht als Grund dabei.
- **Stark:** an ≥ 3 Tagen. Keine Empfehlung, stattdessen Warnkarte, z. B. "Pumpe erhöht hier oft, aber Hypos an 4/14 Tagen, erst Ursache klären".

### 5.6 Gründe

2 bis 4 Stichworte pro Karte aus festen Textbausteinen mit `%1…%n`-Platzhaltern (Konvention wie `stats_renderer.js:20-23`), z. B.:
- "an %1/%2 Tagen hat Control-IQ in diesem Zeitraum Basal erhöht, im Schnitt %3 U/h (%4 %)"
- "an %1/%2 Tagen Korrektur in diesem Zeitraum, im Schnitt %3 U"
- "nach %1/%2 Mahlzeiten BZ nach 2 h über %3 (Median-Spitze %4)"
- "keine Hypo in diesem Zeitraum" bzw. "Hypo an %1/%2 Tagen"
- "Dawn-Bolus an %1/%2 Tagen als Spanne berücksichtigt, Ø %3 U"

Darunter immer die Datenbasis, z. B. "14 Nächte, davon 11 saubere Fastenfenster; 6 Mahlzeiten ohne KH-Eintrag, 3 unklare Boli nicht ausgewertet".

## 6. Darstellung

Reihenfolge auf der Seite:
1. Bestehender Hinweis zur KI und Einleitung (unverändert).
2. **Empfehlungen** (neu): Karten wie im Mockup, inkl. "passt, keine Änderung", "zu wenig Daten" und Warnkarten. Fester Hinweis: Rechenhilfe, keine Therapieanweisung; nur einen Parameter auf einmal ändern.
3. **Perioden-Statistik** mit Spalten Wert, Ziel, Erklärung, plus GMI (3,31 + 0,02392 × Mittelwert mg/dl; Vorbild mit Einheiten-Umrechnung in `glucosedistribution.js:443-445`). Zielwerte: TIR > 70 %, unter Ziel < 4 %, über Ziel < 25 %, CV ≤ 36 %, GMI < 7 %. Wert grün/gelb je nach Ziel; MAGE und SD als grobe Richtwerte **ohne** Färbung. `renderPeriodSummary` bekommt ein Flag (z. B. `opts.explained`); der KI-Tab (`ai_eval.js:337`) ruft weiter die kurze Form auf. Da `renderUtils.table()` jede Zelle escaped und keine Klassen kennt (`render_utils.js:55-63`), braucht es eine Tabellenvariante mit Zellklassen.
4. **Pumpenaktions-Hotspots:** zusätzlich mittlere Abweichung in U/h pro Stunde = `basal_actual.hourly[h] - basal_scheduled.hourly[h]` (Mittel über Pumpentage). Die Daten werden in `pump_analysis.js` an den Chart übergeben.
5. **Basal-Abweichung:** Liniendiagramm bleibt. Fläche rot, wenn geliefert > Profil, blau, wenn geliefert < Profil (zwei `d3.area` mit `.defined()` oder Clip-Pfaden). Das Blau muss sich von der Linienfarbe `#17a2b8` unterscheiden.
6. **Insulinverteilung:** Legenden-Fehler beheben (siehe 7).
7. **Mahlzeiten-Kurven** (neu): je Slot ein Diagramm, BZ ab Bolus 0 bis 4 h; dieselben Fälle wie 5.2 (Dawn-Boli ausgeschlossen); dünne Linien je Mahlzeit, dicke Median-Linie, Zielbereich hinterlegt. Zusammenfassung darunter: Median-Spitze, Median-Zeit bis Spitze, Median-Wert nach 4 h im Vergleich zum Startwert, Anzahl Mahlzeiten.
8. **Episodenzeiten:** unverändert.
9. Bestehende aufklappbare Bereiche (Datenwarnungen, Behandlungsübersicht) unverändert an ihrer Stelle.
10. **Tageszeitliche Muster:** Das bisherige Band (Mittelwert ± Standardabweichung, `charts.js:73-76`) wird durch zwei Perzentil-Bänder (25-75 und 10-90) ersetzt, berechnet aus den Einzelwerten pro Stunde (`entriesByDay`, `localHour`) mit `d3.quantile`.
11. **Tägliche Aufschlüsselung:** 5 Bereiche (< 54, 54 bis untere Grenze, Ziel, obere Grenze bis 250, > 250), berechnet in pump_analysis aus `entriesByDay`.

## 7. Bekannter Fehler: Legende "U/Tag"

`stats_renderer.js`, `renderInsulinLegend` (Zeilen 306-350): alle vier Werte sind bereits Tagesmittel und werden nochmals geteilt:
- Basal geliefert: `basal_actual.total` (Summe der Stundenmittel, `lib/statistics.js:879-882`) / `pumpDays`
- Nutzer-Bolus: `user_total` / `totalDays`
- Auto-Korrektur: `auto_total_by_bucket` / `pumpDays`
- Basal-Profil (Fallback): `basal_scheduled.total` / `totalDays`

Fix: Divisionen entfernen. Test über `renderStats` (die Funktion ist nicht exportiert) mit ≥ 2 Pumpentagen, damit eine doppelte Teilung sichtbar fehlschlägt.

## 8. Technischer Rahmen

### 8.1 Konstanten statt Einstellungen
Einstellungen per `PUMP_ANALYSIS_*` würden heute nicht im Browser ankommen: `lib/server/env.js:369-385` sammelt erweiterte Einstellungen nur für Namen in `ENABLE` und trennt am ersten Unterstrich; nur `clientDefaultPlugins` (`lib/plugins/index.js:17-44`) werden an den Browser gegeben. Deshalb in dieser Ausbaustufe nur Konstanten (Abschnitt 3). Einstellbarkeit ist ein späteres Thema.

### 8.2 Gemeinsam genutzter Code
- `analysis_cache.js` teilt das Analyseergebnis zwischen Pumpen-Analyse und KI-Tab.
- Neue Rechnungen (Empfehlungen, Perzentile, 5 Bereiche, Mahlzeiten-Kurven) liegen in pump_analysis, **nicht** in `periodStats`/`dayStats` aus `lib/statistics.js`, weil diese Objekte 1:1 in die KI-Anfrage gehen (`ai_eval/data_processor.js:35-47`). Werden doch Felder in `statistics.js` ergänzt, müssen sie dort ausgeschlossen werden.

### 8.3 Übersetzungen
Neue Schlüssel in `translations/en/en.json`, `translations/de_DE.json` und `translations/lt_LT.json` (Test `tests/language.test.js` verlangt gleiche Schlüssel und Platzhalter in en und lt). Platzhalter `%1…%n`. Auch die fest englischen Chart-Texte übersetzen: 'Hour of Day', 'Below Range', 'In Range', 'Above Range', aria-labels, 'Charts unavailable' (`charts.js`), sowie die englischen Untertitel der Abschnitte.

### 8.4 Einheiten
Intern in mg/dl rechnen. In mmol/L sind Sensorwerte und Ziele im Report in Anzeige-Einheiten (`reportclient.js`); Werte vor der Rechnung umrechnen, Ergebnisse für die Anzeige zurückrechnen. Test mit `units: 'mmol'`.

### 8.5 Profil
Pflichtschritt vor den Empfehlungen: Fehler "Profil nach dem Enddatum" beheben. In `pump_analysis/data_processor.js:27-32` das Profil mit dem spätesten `startDate` ≤ Enddatum wählen statt `profiles[0]` (Ursache `unshift` in `lib/report/reportclient.js`). Jeder Fall wird gegen das zur Uhrzeit gültige Profil gemessen; Vorschläge beziehen sich auf das zuletzt gültige Profil. Gab es im Zeitraum einen Profilwechsel (`profile_switch_detected` erkennt nur `Profile Switch`-Behandlungen, `lib/statistics.js:1545`), Hinweis in der Empfehlungsbox.

## 9. Reihenfolge der Umsetzung

1. Test-Hygiene: werfende Stubs in `tests/pump_analysis.test.js` ("replaces remaining chart skeletons…") in `finally` zurücksetzen.
2. Profil-Fehler (8.5) mit Regressionstest.
3. Legenden-Fehler (7).
4. Perioden-Statistik mit Erklärungen und GMI (6.3), Test "8 Zeilen" anpassen, KI-Tab bleibt kurz.
5. Übersetzungs-Grundlage (8.3) inkl. bestehender englischer Chart-Texte.
6. Bolus-Klassifizierung (4).
7. Basal-Empfehlungen (5.1, 5.4, 5.5, 5.6).
8. KH-Faktor und Korrekturfaktor (5.2, 5.3).
9. Empfehlungs-Karten (6.2).
10. Grafiken: Basal-Fläche rot/blau, Hotspot-U/h, Mahlzeiten-Kurven, Perzentil-Bänder, 5 Bereiche.

## 10. Prüfung

**Unit-Tests** (TDD, neue Datei `tests/pump_analysis_recommendations.test.js` für die reinen Funktionen; Rendering in `tests/pump_analysis.test.js`). Fixtures mit `created_at` und `utcOffset` (`parseTreatmentLocal` braucht `created_at`). Mindestens ein Test pro Regel:
- Klassifizierung: Dawn (mit/ohne 6 g, Grenze 1,5 U, außerhalb des Fensters), Mahlzeit (±30 min), Korrektur (> 240, schnell steigend), unklar; Cannula/Tubing/UserAborted werden nicht gezählt
- Fastenfenster: Dawn stört nicht, unklarer Bolus stört; CGM-Lücke verwirft
- Richtung und Median, "Passt" (9 % / 10 %), 20 %-Grenze, Rundung
- Block-Zusammenfassung, Vorverlegung, Kollision mit Gegenrichtung/zu wenig Daten, Mitternacht, mehrere Profilsegmente
- Vertrauensstufe an den Grenzen (4/5/7 Fälle, 59/60/74/75 %)
- Gegensignal schwach (Herabstufung, niedrig bleibt niedrig) und stark (Warnkarte)
- Effektiver KH-Faktor inkl. Restkorrektur (Vorzeichen), Nenner ≤ 0; Muster "zu spät gespritzt"
- Korrekturfaktor inkl. Ausschluss bei Folge-Bolus/KH
- Ohne Pumpendaten; Profilwechsel; Profil nach Enddatum
- GMI; 5 Bereiche; Perzentile; Legende (alle vier Werte)
- Einheiten mmol; Übersetzungsschlüssel vorhanden (bestehender language-Test)

**Prüfung im Browser:** Dev-Server gegen die In-Memory-MongoDB mit Seed-Daten (einige Wochen, inkl. Dawn-Boli, Korrekturen, Hypo-Abenden). Prüfen: Empfehlungskarten, Warnkarte, "zu wenig Daten", Legende zeigt plausible U/Tag, Basal-Fläche rot/blau, Mahlzeiten-Kurven, KI-Tab-Tabelle unverändert kurz. Zum Schluss mit den echten Daten (21.10.-03.11.) gegen die Screenshots plausibilisieren.

Code-Stil laut `CLAUDE.md`; Tests via `npm run test-local -- ./tests/<datei>.test.js`; Lint via `npm run lint`. Arbeit auf Feature-Branch, Merge nach `master` (ggf. vorher `staging`).

## 11. Dem Builder überlassen

- Modulaufteilung innerhalb von `pump_analysis/` und Namen der Konstanten.
- Gestaltung im Detail, solange sie dem Mockup folgt.
- Form des Seed-Skripts.
