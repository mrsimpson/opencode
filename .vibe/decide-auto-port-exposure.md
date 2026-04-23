# ADR: Automatisches Port-Exposure für Dev-Server

_Generated on 2026-04-23 by Vibe Feature MCP_

## Status

Accepted

## Context

Session-Pods (Benutzer starten Vite, Next.js, etc. auf Ports >3000) sind nur intern über Port 4096 erreichbar. Externe Benutzer können darauf nicht zugreifen.

## Decision

1. **Router erweitern**: `/api/ports` Endpoint → liest `/proc/net/tcp` und gibt aktive Ports >3000 zurück
2. **Operator erweitern**: Nach Pod-ADDED, polled `GET podIP:4096/api/ports` und created für jeden Port eine eigene TunnelRoute + IngressRoute
3. **Naming Schema**: `<port>-<hash>-oc.<domain>` → proxy zu podIP:<port>
4. **Router erweitern**: Extrhiert Port aus Hostname (Pattern `<port>-<hash>-...`) und proxy zu entsprechendem Port

## Consequences

- **Positive**:
  - Kein explizites Freigeben nötig
  - Funktioniert automatisch mit allen Dev-Servern
  - Minimale Änderungen an bestehender Architektur

- **Negative**:
  - Erhöhte Komplexität beim Operator (polling + dynamische Routes)
  - DNS/Tunnel Routes werden erst nach dem ersten Request erstellt (lazy)
