# ROADRAGE DERBY

Browser-Auto-Derby: Ramm deinen Gegner von einer schrumpfenden Plattform oder bring seine HP auf null. Power-Ups, Hazards und ein leichtes Comeback-Rubber-Banding sorgen dafür, dass nicht immer nur der technisch bessere Spieler gewinnt — Matches sind Best-of-5.

Läuft komplett im Browser (Three.js + cannon-es), lokal zu zweit (WASD vs. Pfeiltasten) oder online 1v1 per WebRTC (PeerJS, kein eigener Server nötig).

## Entwicklung

```bash
npm install
npm run dev       # Dev-Server mit Hot Reload
npm run build      # Produktions-Build nach dist/
npm run preview    # Build lokal testen
```

## Steuerung

- **Lokal:** Spieler 1 = WASD (+ Shift zum Bremsen), Spieler 2 = Pfeiltasten (+ Rechter Shift)
- **Online:** Jeder Spieler steuert mit WASD auf seinem eigenen Rechner

## Deployment

Push auf `main` deployt automatisch via GitHub Actions nach GitHub Pages (siehe `.github/workflows/deploy.yml`). Für die eigene Domain siehe [DOMAIN_SETUP.md](./DOMAIN_SETUP.md).
