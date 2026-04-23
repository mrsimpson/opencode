# Development Plan: repo (late-tips-feel branch)

_Generated on 2026-04-23 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

Das Homelab Deployment erweitern, damit Ports von im opencode Container gestarteten Webservern auch von außerhalb erreichbar sind (z.B. Vite Dev Server auf Port 5173, Next.js Dev Server auf Port 3000).

## Key Decisions

### Aktuelle Architektur verstanden:

1. **Session-Pods werden dynamisch erstellt** (`packages/opencode-router/src/pod-manager.ts`)
   - Ein Pod pro Session (User + Repo + Branch)
   - Pod läuft mit `opencode serve` auf Port 4096 (internal)
   - Nur dieser Port ist im Container definiert

2. **Zugriff nur über Router** (`packages/opencode-router/src/index.ts`)
   - Alle Requests kommen über `<hash>-oc.<domain>`
   - Router proxied an Pod-IP:4096
   - Andere Ports werden nicht exponiert

3. **Cloudflare Tunnel + Traefik IngressRoute**
   - Operator (separate Deployment) watched Pods
   - Erstellt DNS + Tunnel Route für `<hash>-oc.<domain>`
   - Nur der Session-Endpoint ist erreichbar

4. **Port-Belegung im Session-Pod**
   - Port 4096: `opencode serve` (main server, MCP endpoints)
   - Ports >3000: Benutzer starten selbst (Vite, Next.js Dev Server, etc.)
   - Ports <1024: System-Ports

### Key Decisions (final)

- **Automatisches Port-Exposure**: Alle Ports >3000 werden automatisch exponiert
- **Keine explizite Freigabe nötig**: Wer Prozesse starten kann, hat bereits vollen Zugriff
- **Pro Port eine Tunnel Route**: `<port>-<hash>-oc.<domain>`
- **Port-Erkennung via /proc/net/tcp**: Session-Pod liest aktive Ports aus /proc/net/tcp
- **Router extrahiert Port aus Hostname**: Bei `<port>-<hash>-oc.<domain>` → proxy zu podIP:<port>

## Completed (Code Phase)

### Implementierte Features

1. **Router: `/api/ports` Endpoint** (`packages/opencode-router/src/api.ts`)
   - Liest Ports aus `/proc/net/tcp`, filtert >3000
   - Returns `{ ports: number[] }`

2. **Router: Port-Extraktion** (`packages/opencode-router/src/index.ts`)
   - Neue `getSessionInfo()` Funktion erkennt `<port>-<hash>-oc.<domain>` Pattern
   - Proxy zu `podIP:<port>` statt nur `:4096`

3. **Cloudflare-Operator: Port-Polling** (`deployment/opencode-cloudflare-operator/src/index.ts`)
   - `pollPodPorts()` pollt Pod nach aktiven Ports via `/api/ports`
   - Für jeden Port werden DNS + TunnelRoute + IngressRoute erstellt

4. **Cloudflare-Operator: Config erweitert**
   - `opencodePort` config (default 4096)
   - `sessionPortHostname()` helper für `<port>-<hash>-oc.<domain>`

5. **Tests** (30 tests passing)
   - `api.test.ts`: GET /api/ports test
   - `hostname.test.ts`: Port-Extraktion tests

### URLs nach Deployment

- Session: `abc123def456-oc.no-panic.org` → pod:4096 (bestehend)
- Vite: `5173-abc123def456-oc.no-panic.org` → pod:5173 (neu)
- Next.js: `3000-abc123def456-oc.no-panic.org` → pod:3000 (neu)

## Notes

- Der Cloudflare-Operator ist unter `deployment/opencode-cloudflare-operator/` (nicht im Monorepo)
- `deployment/homelab/src/index.ts` zeigt die aktuelle Infrastruktur
- Session-Pods sind Kubernetes Pods, keine speziellen Ressourcen

### Cloudflare-Operator Verhalten (aus `deployment/opencode-cloudflare-operator/src/index.ts`):

1. **Watched Pods** → ADDED: erstellt DNS + Tunnel Route + IngressRoute
2. **Watched Pods** → DELETED: löscht Tunnel Route + IngressRoute (DNS bleibt für Resumption)
3. **Watched PVCs** → DELETED: löscht DNS (echte Termination)

4. **Aktuelle Limitation**: Nur EIN hostname pro Session (`<hash>-oc.<domain>`)
   - Router proxied anhand Hash im Host-Header
   - Andere Ports nicht erreichbar

5. **Ports die Benutzer typischerweise starten**: vite, bun, next, nuxt, node, etc.
   - Übliche Ports: 3000, 3001, 5173, 4173, 8000, 8080
   - Wir können diese automatisch erkennen oder per Config erlauben

### Für Port-Exposure müssen wir erweitern:

- Entweder: Multiple hostnames (`5173-<hash>.oc.<domain>`) mit Routing nach Port
- Oder: Path-based routing (nicht ideal für Dev Server)
- Oder: NodePort/HostNetwork (Security-Risiko)

### Architecture Entscheidung (nach Code-Phase):

**Gewählter Ansatz: Multiple Hostnames mit Port-basiertem Routing**

1. **Dockerfile /opencode-utils**: Utility-Script das `/proc/net/tcp` liest und aktive Ports >3000 zurückgibt
2. **Cloudflare-Operator**: Watched auch Ports (oder via HTTP Endpoint vom Router) und erstellt pro Port eine eigene Tunnel Route → DNS + IngressRoute
3. **Router**: Erweitert um Port-Extraktion aus Hostname → `Host("5173-<hash>-oc.<domain>")` → proxy zu podIP:5173

**Beispiel URLs:**

- Session: `<hash>-oc.<domain>` → podIP:4096 (bestehend)
- Vite: `5173-<hash>-oc.<domain>` → podIP:5173 (neu)
- Next.js: `3000-<hash>-oc.<domain>` → podIP:3000 (neu)

## Explore

### Tasks

- [x] Architektur des Session-Pods verstehen (pod-manager.ts, router)
- [x] Cloudflare-Operator Verhalten verstehen (deployment/opencode-cloudflare-operator)
- [x] Aktuelle Port-Belegung identifizieren (nur 4096)
- [x] Übliche Dev-Server Ports dokumentieren
- [x] Lösungsansätze skizzieren

### Completed

- [x] Architektur vollständig verstanden
- [x] Alle relevanten Dateien gelesen

## Implement

### Tasks

- [x] **1. Port-Erkennung im Session-Pod** - Utility-Script das aktive Ports aus `/proc/net/tcp` liest
  - Filtert nur Ports >3000 (User-Dev-Server)
  - Output: Array von Ports
  - **Location**: `/api/ports` Endpoint in Router (api.ts)

- [x] **2. Cloudflare-Operator erweitern** - Erstellt für jeden Port (>3000) eine eigene Tunnel Route + IngressRoute
  - DNS: `<port>-<hash>-oc.<domain>`
  - IngressRoute: Traefik route zum pod:<port> (NICHT router:80!)
  - pollPodPorts() added in operator index.ts

- [x] **3. Router erweitern** - Extrhiert Port aus Hostname und proxy zu podIP:<port>
  - Erkenne Pattern `<port>-<hash>-oc.<domain>` vs `<hash>-oc.<domain>`
  - Wenn Port präsent: proxy zu podIP:<port>
  - Wenn kein Port: proxy zu podIP:4096 (bestehend)

- [ ] **4. Port-Cleanup bei Pod-Stopp** - Wenn Dev-Server stirbt, Port aus Tunnel Route entfernen
  - **Option A**: Cleanup via Watcher (Pod geloescht → alle Routes aufgeraeumt)
  - **Option B**: Fallback auf Port 4096 wenn Dev-Server nicht laeuft

- [ ] **5. Testen**
  - Vite auf 5173 starten → extern erreichbar via `5173-<hash>-oc.<domain>`
  - Next.js auf 3000 starten → extern erreichbar via `3000-<hash>-oc.<domain>`

### Completed

- [x] **Router: `/api/ports` Endpoint** - `api.ts`: Liest Ports aus `/proc/net/tcp`, filtert >3000
- [x] **Router: Port-Extraktion** - `index.ts`: Neue `getSessionInfo()` Funktion erkennt `<port>-<hash>-oc.<domain>` Pattern
- [x] **Router: Port-basiertes Proxying** - Proxy zu `podIP:<port>` statt nur `:4096`
- [x] **Cloudflare-Operator: Port-Polling** - `index.ts`: `pollPodPorts()` pollt Pod nach aktiven Ports
- [x] **Cloudflare-Operator: Per-Port Routes** - Für jeden Port DNS + TunnelRoute + IngressRoute erstellen
- [x] **Cloudflare-Operator: Config erweitert** - `opencodePort` config + `sessionPortHostname()`
- [x] **Tests (38 total passing)**
  - Router: 30 tests (api.test.ts, hostname.test.ts, config.test.ts)
  - Operator: 8 tests (index.test.ts)

## Finalize

### Tasks

- [ ] _To be added when this phase becomes active_

### Completed

_ None yet_

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
