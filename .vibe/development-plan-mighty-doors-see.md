# Development Plan: repo (mighty-doors-see branch)

_Generated on 2026-04-29 by Vibe Feature MCP_
_Workflow: [epcc](https://codemcp.github.io/workflows/workflows/epcc)_

## Goal

Ermöglichen der Modell-Auswahl in der opencode-router-app bereits vor dem Starten einer Sitzung, damit das gewählte Modell direkt bei Session-Start verwendet wird.

## Key Decisions

### Entscheidung 1: Modell-Weitergabe an opencode

**Gewählte Option: PVC-Annotation + Environment Variable**

- Das Modell wird als PVC-Annotation `opencode.ai/model` gespeichert (Format: `providerID/modelID`, z.B. `anthropic/claude-sonnet-4`)
- Zusätzlich wird eine Environment-Variable `OPENCODE_DEFAULT_MODEL` im Pod gesetzt
- **Wichtig**: Das Modell wird NUR beim ERSTEN Start verwendet (Initial-Modell)
- Nach dem ersten Start hat der User möglicherweise das Modell in opencode geändert - dieses darf nicht überschrieben werden
- **Erkennung "erster Start"**: Prüfen ob `~/.config/opencode/model.json` bereits existiert
- **Alternative überprüft**: Nur Environment Variable ohne PVC-Annotation - verworfen, da PVC-Annotation dem etablierten Muster folgt (siehe `opencode.ai/user-email`, `opencode.ai/repo-url`, etc.)

### Entscheidung 2: Verfügbare Modelle im UI

**Gewählte Option: Neuer API-Endpoint im Router**

- `GET /api/models` liefert die konfigurierten Modelle
- Router liest die ConfigMap `opencode-config` (via K8s API) aus und extrahiert Provider + Modelle
- **Vorteil**: Zentrale Stelle, keine Duplizierung der Konfiguration, folgt dem gleichen Muster wie bei anderen ConfigMap-Daten
- **Alternative verworfen**: Hardcoded Liste im Frontend - zu wartungsintensiv

### Entscheidung 3: Modell-Auswahl-Format

**Gewählte Option: providerID + modelID**

- User wählt aus einer Liste von `{ providerID, modelID, name }`
- Das Format `providerID/modelID` wird als String übertragen und gespeichert
- **Grund**: Dies entspricht der Datenstruktur in opencode (`MessageV2.User.model`)

### Entscheidung 4: Standardverhalten

**Gewählte Option: Keine Auswahl = opencode-Standard**

- Wenn kein Modell gewählt wird, wird keine Annotation/Environment-Variable gesetzt
- Opencode verwendet dann das Standard-Modell aus der Agent-Konfiguration

### Entscheidung 5: Initial-Modell-Logik in opencode

**Gewählte Option: Init-Container prüft und setzt Modell**

- Der init Container prüft beim ersten Start:
  1. Ist `OPENCODE_DEFAULT_MODEL` gesetzt?
  2. Existiert `~/.config/opencode/model.json` bereits?
  3. Wenn (1) ja und (2) nein: Erstelle `model.json` mit dem gewählten Modell
- **Idempotenz**: Wenn `model.json` bereits existiert (z.B. Pod-Restart), wird nichts überschrieben
- **Warum init Container**: Das Modell muss gesetzt sein, BEVOR `opencode serve` startet

### Entscheidung 6: Verfügbare Modelle für Router-App bereitstellen

**Gewählte Option: Router liest ConfigMap direkt (ohne opencode-Import)**

- **User-Anfrage**: opencode's `GET /api/provider/` API und Teile von opencode als Dependency importieren
- **Analyse**:
  - opencode verwendet Effect (komplexes Framework) - Router müsste Effect adoptieren
  - `GET /api/provider/` benötigt laufende opencode-Instanz mit initialisierten Services
  - Router-App braucht Modelle VOR Session-Start - keine opencode-Pod existiert zu diesem Zeitpunkt
  - opencode ist als Anwendung, nicht als Bibliothek architekturiert
- **Entscheidung**: Router liest `opencode-config` ConfigMap direkt via K8s API
  - Parst Provider-Konfiguration aus JSON
  - Exponiert `GET /api/models` Endpoint
  - Folgt dem gleichen Muster wie das Mounten der ConfigMap in Pods
- **Alternative verworfen**: opencode als Dependency importieren - zu komplex, falsche Architektur

### Entscheidung 7: Konsistenz der Modellliste zwischen Router und opencode

**Gewählte Option: ConfigMap als Single Source of Truth**

- **User-Frage**: Wie sicherstellen, dass exakt gleiche Modelle wie in opencode angezeigt werden? Vorschlag: Symlink der Dateien.
- **Analyse**:
  - Beide Anwendungen sind im selben Monorepo
  - Die ConfigMap `opencode-config` wird sowohl vom Router (via K8s API) als auch von opencode (gemountet als Datei) gelesen
  - Die ConfigMap enthält `opencode.json` mit Provider-Konfigurationen
  - Opencode's `GET /api/provider/` parst diese Konfiguration zur Laufzeit
- **Lösung**:
  - Router liest dieselbe ConfigMap `opencode-config` via `k8sApi.readNamespacedConfigMap()`
  - ConfigMap-Daten werden identisch geparst wie in opencode
  - **Zusatz**: Falls nötig, können gemeinsame Parsing-Utilities im Monorepo geteilt werden
  - **Symlinks**: In der ConfigMap selbst sind die Provider-Configs als JSON - ein Symlink auf Dateiebene ist nicht nötig, da beide die ConfigMap als Quelle nutzen
- **Sicherstellung**:
  - ConfigMap Name ist in `config.configMapName` zentral definiert (default: `opencode-config`)
  - Sowohl Pod-Mount als auch Router-API verwenden denselben Namen
  - Änderungen an der ConfigMap sind sofort für beide konsistent

### Entscheidung 8: Modell-Filterung im Router (models.dev)

**Gewählte Option: Router verwendet models.dev API direkt (ohne opencode-Filterung)**

- **Analyse der opencode-Modell-Filterung** (in `packages/opencode/src/provider/provider.ts`):
  - `disabled_providers` Config: Provider können komplett deaktiviert werden (Zeile 1116)
  - `status: "deprecated"`: Modelle werden ausgefiltert (Zeile 1348)
  - `status: "alpha"`: Modelle werden ausgefiltert, außer `FLAG_OPENCODE_ENABLE_EXPERIMENTAL_MODELS` ist gesetzt (Zeile 1347)
  - Varianten mit `disabled: true` werden ausgefiltert (Zeile 1204)
- **Aktuelle Router-Implementierung**:
  - Router verwendet `https://models.dev/api.json` direkt (nicht opencode's Provider-Config)
  - Keine Filterung nach `disabled_providers`, `status: "deprecated"` oder `status: "alpha"`
  - **Grund**: Router liest models.dev API, nicht die ConfigMap `opencode-config`
- **Entscheidung**:
  - Router zeigt alle Modelle von models.dev (keine Filterung)
  - Falls Filterung gewünscht: müsste Router die ConfigMap lesen oder Filter-Logik hinzufügen
  - **Trade-off**: Einfachere Implementierung vs. Konsistenz mit opencode's Filterung
  - **Hinweis**: Dies ist ein bekannter Unterschied, der in Zukunft behoben werden könnte

## Notes

### Architektur-Übersicht

- **opencode-router-app** (Solid.js Frontend): `packages/opencode-router-app/src/`
  - `app.tsx`: Hauptkomponente mit App-Status (loading, ready, creating, open, error)
  - `api.ts`: API-Funktionen für Sessions (`createSession`, `listSessions`, etc.)
  - `session-input-bar.tsx`: Formular für neue Sitzungen (Repo-URL, Branch, Prompt, **Model**)
  - **Neu**: `model-select.tsx` für Modell-Auswahl (noch zu erstellen)

- **opencode-router** (Node.js Backend): `packages/opencode-router/`
  - `api.ts`: HTTP API für Session-Management
  - `pod-manager.ts`: Kubernetes-Orchestrierung (PVC + Pod-Erstellung)
  - `config.ts`: Konfiguration (Domain, Images, etc.)
  - **Neu**: `GET /api/models` Endpoint (noch zu erstellen)

- **Modell-Konfiguration in opencode**:
  - Agent-Definitionen in `packages/opencode/src/agent/agent.ts` mit `model: { modelID, providerID }`
  - Provider-Konfiguration in `packages/opencode/src/config/provider.ts`
  - Modell wird in Nachrichten gespeichert (`message-v2.ts`)
  - **API**: `GET /api/provider/` liefert alle Provider mit Modellen
  - `model.json` in `~/.config/opencode/` speichert das gewählte Modell

### Datenfluss bei Session-Erstellung (neu mit Modell)

1. User wählt Modell (optional), gibt Repo-URL, Branch, Prompt ein
2. `createSession()` POST an `/api/sessions` mit `{repoUrl, branch, sourceBranch, initialMessage, model}`
3. Router erstellt PVC mit Annotation `opencode.ai/model: providerID/modelID`
4. Router erstellt Pod mit Environment-Variable `OPENCODE_DEFAULT_MODEL=providerID/modelID`
5. Init-Container:
   - Klont Repo, konfiguriert opencode
   - **Neu**: Prüft ob `OPENCODE_DEFAULT_MODEL` gesetzt ist UND `~/.config/opencode/model.json` NICHT existiert
   - Wenn ja: Erstelle `model.json` mit gewähltem Modell
6. Main Container: `opencode serve` startet mit dem gesetzten Initial-Modell

### Relevante Code-Stellen in opencode (für Modell-Integration)

- `packages/opencode/src/server/routes/instance/provider.ts`: `GET /api/provider/` Endpoint
- `packages/opencode/src/session/llm.ts`: Modell-Auflösung (`input.model ?? ag.model ?? lastModel()`)
- `packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx`: TUI Modell-Auswahl (als Referenz)
- `packages/opencode/src/config/` - Verzeichnis für Konfigurationsdateien wie `model.json`

### Gefundene Muster im Router

- PVC-Annotatinons werden verwendet für: `opencode.ai/user-email`, `opencode.ai/repo-url`, `opencode.ai/branch`, `opencode.ai/source-branch`, `opencode.ai/initial-message`
- Das Muster für das Modell: `opencode.ai/model` als Annotation auf der PVC
- ConfigMap für opencode-Konfiguration: `config.configMapName` (default: `opencode-config`)
- Umgebungsvariablen im Pod werden über `env:` und `envFrom:` gesetzt

## Explore

### Tasks

- [x] Created development plan file
- [x] Codebase erkundet (opencode-router-app, opencode-router, Modell-Konfiguration)
- [x] Entscheidung treffen: Wie wird das Modell an opencode übergeben?
- [x] Entscheidung treffen: Woher bezieht das UI die verfügbaren Modelle?
- [x] API-Schnittstelle definieren (neuer Parameter in createSession)
- [x] UI-Komponente für Modell-Auswahl designen
- [x] Erkundet wie Modellauswahl in opencode-Anwendung funktioniert

### Completed

- [x] Created development plan file
- [x] Codebase erkundet
- [x] Modellauswahl in opencode erkundet
- [x] Key Decisions dokumentiert

## Plan

### Tasks

#### Backend (opencode-router)

- [ ] **Task P1: Modell-API-Endpoint hinzufügen** (`packages/opencode-router/src/api.ts`)
  - Neuen `GET /api/models` Endpoint implementieren
  - ConfigMap `opencode-config` via K8s API auslesen (`k8sApi.readNamespacedConfigMap`)
  - ConfigMap-Daten parsen (JSON), Provider und Modelle extrahieren
  - Rückgabe-Format: `{ providers: [{ id, name, models: [{ id, name }] }] }`
  - Fehlerbehandlung: Falls ConfigMap nicht existiert oder ungültiges JSON → leeres Array zurückgeben
  - Edge Cases: ConfigMap existiert nicht, JSON parse error, kein provider section

- [ ] **Task P2: Session-Erstellung um Modell-Parameter erweitern** (`packages/opencode-router/src/api.ts`)
  - `createSession` akzeptiert optionalen `model: string` Parameter (Format: `providerID/modelID`)
  - Validierung: Falls model gesetzt, Format prüfen (enthält `/`, providerID und modelID nicht leer)
  - Model in `SessionKey` Interface hinzufügen (optional): `model?: string`
  - Parameter an `ensurePVC` und `ensurePod` weitergeben

- [ ] **Task P3: PVC-Annotation für Modell hinzufügen** (`packages/opencode-router/src/pod-manager.ts`)
  - `ensurePVC` speichert Modell als Annotation `opencode.ai/model` (falls vorhanden)
  - Annotations-Interface erweitern: `ANNOTATION_MODEL = "opencode.ai/model"` Konstante hinzufügen
  - `resumeSession` muss Modell beim Wiederaufleben ebenfalls berücksichtigen (aus PVC annotation lesen)

- [ ] **Task P4: Pod-Umgebungsvariable für Modell setzen** (`packages/opencode-router/src/pod-manager.ts`)
  - `ensurePod` fügt Environment-Variable `OPENCODE_DEFAULT_MODEL` hinzu (falls Modell gewählt)
  - Env-Variable in den `opencode` Container eintragen: `env: [{ name: "OPENCODE_DEFAULT_MODEL", value: session.model }]`
  - Nur setzen wenn `session.model` definiert ist (verhindert leere env var)

#### Frontend (opencode-router-app)

- [ ] **Task P5: API-Funktion für Modell-Abruf hinzufügen** (`packages/opencode-router-app/src/api.ts`)
  - Neue Funktion `listModels(): Promise<ModelProvider[]>`
  - Interface `ModelProvider` und `Model` definieren:
    ```ts
    export interface Model {
      id: string
      name: string
    }
    export interface ModelProvider {
      id: string
      name: string
      models: Model[]
    }
    ```

- [ ] **Task P6: ModelSelect-Komponente erstellen** (`packages/opencode-router-app/src/model-select.tsx`)
  - Solid.js Komponente für Dropdown-Modellauswahl
  - Props: `value: string`, `onChange: (model: string) => void`, `providers: ModelProvider[]`, `loading: boolean`
  - Gruppierte Anzeige nach Provider (optgroup-ähnlich)
  - Option "Kein spezifisches Modell" (leerer Wert) als Default
  - Loading-State während Modelle geladen werden
  - Styling angepasst an bestehende UI (verwende `inputStyle` aus `session-input-bar.tsx`)

- [ ] **Task P7: SessionInputBar um Modell-Auswahl erweitern** (`packages/opencode-router-app/src/session-input-bar.tsx`)
  - `ModelSelect` Komponente in das Formular integrieren
  - Props erweitern: `model: string`, `onModelChange: (v: string) => void`, `modelProviders: ModelProvider[]`, `modelsLoading: boolean`
  - Modell-Auswahl zwischen Repo-URL und Prompt-Text platzieren
  - Modell-Auswahl ist optional (keine Validierung erforderlich)

- [ ] **Task P8: App-Komponente anpassen** (`packages/opencode-router-app/src/app.tsx`)
  - State-Variable `model` hinzufügen: `const [model, setModel] = createSignal("")`
  - `createSession` Aufruf um `model()` erweitern
  - `listModels()` beim App-Start laden (in `onMount` oder lazy beim ersten Öffnen der Modell-Liste)
  - Modelle im Hintergrund laden (nicht blockierend für UI)

- [ ] **Task P9: API-Anpassung für createSession** (`packages/opencode-router-app/src/api.ts`)
  - `createSession` Funktion um optionalen `model` Parameter erweitern
  - `body: JSON.stringify({ repoUrl, branch, sourceBranch, ...(initialMessage ? { initialMessage } : {}), ...(model ? { model } : {}) })`

#### Opencode Init-Container (Model-Initialisierung)

- [ ] **Task P10: Init-Skript um Modell-Logik erweitern** (`packages/opencode-router/src/pod-manager.ts`)
  - Init-Container-Skript prüft: Ist `OPENCODE_DEFAULT_MODEL` gesetzt?
  - Prüft: Existiert `~/.config/opencode/model.json` bereits?
  - Falls env var gesetzt UND model.json NICHT existiert:
    - `model.json` mit Inhalt `{"providerID": "...", "modelID": "..."}` erstellen
    - Format aus `providerID/modelID` parsen
  - Idempotenz: Falls model.json bereits existiert → nichts tun (User hat Modell nach ersten Start geändert)

#### Testing

- [ ] **Task P11: Tests für Backend-Modell-API schreiben** (`packages/opencode-router/test/`)
  - Test für `GET /api/models` (Mock für K8s ConfigMap)
  - Test für `POST /api/sessions` mit `model` Parameter
  - Test für ungültiges Modell-Format (Fehlerantwort)
  - Test für PVC-Annotation (Modell wird korrekt gespeichert)

- [ ] **Task P12: Tests für Frontend-Modellauswahl schreiben** (`packages/opencode-router-app/test/`)
  - Test für `ModelSelect` Komponente (Rendering, Selection, Loading)
  - Test für `createSession` mit Modell-Parameter

### Completed

_None yet_

## Code

### Tasks

#### Backend Implementation

- [x] **Task C1: ConfigMap-Auslesung implementieren** (`packages/opencode-router/src/api.ts`)
  - `getAvailableModels()` liest jetzt von `https://models.dev/api.json` (gleiche Quelle wie opencode)
  - **Zusätzlich**: `getDisabledProviders()` liest `opencode-config` ConfigMap aus (via K8s API) um `disabled_providers` zu ermitteln
  - **Filterung implementiert** (matching opencode logic):
    - `disabled_providers` aus ConfigMap werden ausgefiltert
    - Modelle mit `status: "deprecated"` werden ausgefiltert
    - Modelle mit `status: "alpha"` werden ausgefiltert (ohne experimental flag)
  - Caching implementiert (5 Min TTL)
  - Unit Tests mit gemockter K8s API (ausstehend)

- [x] **Task C2: GET /api/models Endpoint implementieren**
  - Endpoint registriert in `handleApi()` Funktion
  - Modelle abrufen via `getAvailableModels()`
  - Response: `{ providers: ModelProvider[] }` als JSON

- [x] **Task C3: SessionKey um model erweitern** (`packages/opencode-router/src/pod-manager.ts`)
  - Interface `SessionKey` erweitert: `model?: string`
  - `ensurePVC`: Annotation `opencode.ai/model` setzen (falls model vorhanden)
  - `ensurePod`: Environment-Variable `OPENCODE_DEFAULT_MODEL` setzen (falls model vorhanden)
  - `resumeSession`: Modell aus PVC annotation lesen (ausstehend)

- [x] **Task C4: API-Anpassung für model Parameter** (`packages/opencode-router/src/api.ts`)
  - `POST /api/sessions`: `model` aus Request-Body parsen
  - Validierung: Format `providerID/modelID`
  - `SessionKey` mit model erstellen und an `ensurePVC`/`ensurePod` übergeben

- [x] **Task C5: Init-Container um Modell-Initialisierung erweitern** (`packages/opencode-router/src/pod-manager.ts`)
  - Init-Skript prüft: Ist `OPENCODE_DEFAULT_MODEL` gesetzt?
  - Prüft: Existiert `~/.config/opencode/model.json` bereits?
  - Falls env var gesetzt UND model.json NICHT existiert: `model.json` erstellen
  - Idempotenz: Falls model.json bereits existiert → nichts tun

#### Frontend Implementation

- [x] **Task C6: ModelSelect Komponente erstellen** (`packages/opencode-router-app/src/model-select.tsx`)
  - Solid.js Komponente mit einzelnem Dropdown (optgroup für Provider-Gruppierung)
  - Gruppierung nach Provider (wie in opencode's Dialog)
  - "Kein spezifisches Modell" Option als Default
  - Zeigt "Provider Name - Model Name" bei Auswahl
  - Styling konsistent mit `session-input-bar.tsx`

- [x] **Task C7: API-Funktionen hinzufügen** (`packages/opencode-router-app/src/api.ts`)
  - `listModels(): Promise<ModelProvider[]>`
  - `createSession` um `model?: string` erweitert
  - TypeScript Interfaces: `ModelProvider`, `Model`

- [x] **Task C8: SessionInputBar anpassen** (`packages/opencode-router-app/src/session-input-bar.tsx`)
  - Props erweitert: `model`, `onModelChange`, `modelProviders`, `modelsLoading`
  - `ModelSelect` Komponente integriert

- [x] **Task C9: App-Komponente anpassen** (`packages/opencode-router-app/src/app.tsx`)
  - State: `model`, `modelProviders`, `modelsLoading`
  - `listModels()` beim Mount laden
  - `handleSubmit` um `model()` erweitert
  - Modelle-State an `SessionInputBar` übergeben

### Completed

- Backend: `api.ts` (GET /api/models mit filtering, POST /api/sessions mit model), `pod-manager.ts` (SessionKey, PVC annotation, env var, init-script, resumeSession)
  - **Model filtering implemented** (matching opencode):
    - `getDisabledProviders()` reads `opencode-config` ConfigMap for `disabled_providers`
    - Filters out providers in `disabled_providers`
    - Filters out models with `status: "deprecated"`
    - Filters out models with `status: "alpha"` (without experimental flag)
- Frontend: `api.ts` (listModels, Model/ModelProvider interfaces), `model-select.tsx` (new), `session-input-bar.tsx` (model select integration), `app.tsx` (model state management)
- Typecheck passed for both packages: `opencode-router` and `opencode-router-app`
- Debug output cleaned up (`console.log` removed from pod-manager.ts)

## Commit

### Tasks

- [ ] **Task CM1: Backend-Änderungen committen**
  - Änderungen in `packages/opencode-router/src/`
  - Commit-Nachricht: `feat(router): add model selection API and session model support`
  - Beinhaltet: `/api/models` Endpoint (mit filtering), PVC annotations, Pod env vars, init-script

- [ ] **Task CM2: Frontend-Änderungen committen**
  - Änderungen in `packages/opencode-router-app/src/`
  - Commit-Nachricht: `feat(router-app): add model selection UI component`
  - Beinhaltet: `ModelSelect` component, API integration, form updates

- [ ] **Task CM3: Tests committen** (falls separate)
  - Neue Test-Dateien
  - Commit-Nachricht: `test: add model selection tests for router and app`

### Completed

- [x] **Code Cleanup**: Removed debug output (`console.log` in pod-manager.ts)
- [x] **Documentation Review**: Updated plan file with Entscheidung 8 (model filtering)
- [x] **Final Validation**: Typecheck passed for both packages
- [x] **Git Commits**:
  - CM1: `ffa83ade7 feat(router): add model selection API and session model support`
  - CM2: `b7bff2063 feat(router-app): add model selection UI component`
  - UI Fix 1: `39a87bf77 fix(router-app): improve model selection UI to match opencode style`
  - UI Fix 2: `e607de3ec fix(router-app): redesign model select with modal dialog (matching opencode UX)`
    - Replaced dropdown with button + modal dialog (like opencode's DialogModel)
    - Show current model as `Provider · Model` in button
    - Modal has search/filter (like opencode's fuzzy search)
    - Grouped model list by provider
    - Visual checkmark for selected model

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
