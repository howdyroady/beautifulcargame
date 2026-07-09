# roadrape.com auf GitHub Pages einrichten

Das Repo ist bereits vorbereitet: `.github/workflows/deploy.yml` baut und deployt bei jedem Push auf `main` automatisch nach GitHub Pages, und `public/CNAME` enthält bereits `roadrape.com`. Du musst nur noch GitHub Pages aktivieren und die DNS-Einträge bei deinem Domain-Registrar setzen.

⚠️ **Kurzer Hinweis vorab:** "roadrape.com" enthält ein Wort, das von manchen Ad-Netzwerken, Safe-Search-Filtern oder Content-Moderationssystemen (z.B. falls du das Spiel später bei einer Plattform wie CrazyGames einreichen willst) automatisch geblockt werden könnte. Kein technisches Problem, aber bedenke es, bevor du Zeit/Geld in die Domain investierst.

## 1. GitHub Pages aktivieren

1. Gehe im Repo zu **Settings → Pages**.
2. Unter "Build and deployment" → **Source**: wähle **GitHub Actions** (nicht "Deploy from a branch") — der mitgelieferte Workflow übernimmt den Rest.
3. Push einmal auf `main`, damit die Action läuft. Danach ist die Seite unter `https://<dein-github-username>.github.io/<repo-name>/` erreichbar.

## 2. Custom Domain in GitHub eintragen

1. Immer noch unter **Settings → Pages** → Feld **Custom domain**: trage `roadrape.com` ein und speichere.
   - GitHub schreibt dabei automatisch die Datei `CNAME` im Repo — die ist aber schon vorhanden (`public/CNAME`), das ist also nur eine Bestätigung.
2. Setze **noch nicht** "Enforce HTTPS" — das geht erst, sobald die DNS-Einträge (Schritt 3) live sind und GitHub das Zertifikat ausgestellt hat.

## 3. DNS-Einträge bei deinem Registrar setzen

Geh zu dem Anbieter, bei dem du `roadrape.com` registriert hast (z.B. Namecheap, Cloudflare, IONOS, etc.) und trage im DNS-Bereich der Domain folgende Einträge ein:

### A-Records für die nackte Domain (`roadrape.com`, ohne `www`)

| Typ | Name | Wert |
|-----|------|------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

Alle vier eintragen (nicht nur eine) — das sind die offiziellen GitHub-Pages-IPs.

### CNAME für `www.roadrape.com`

| Typ | Name | Wert |
|-----|------|------|
| CNAME | www | `<dein-github-username>.github.io` |

### TXT-Verifizierung (empfohlen, optional)

Falls du verhindern willst, dass jemand anders versehentlich dieselbe Domain für ein eigenes GitHub-Pages-Repo beansprucht:

1. In GitHub: **Settings (Account oder Organisation) → Pages → "Add a domain"** startet einen Verifizierungs-Flow und zeigt dir einen TXT-Record wie `_github-pages-challenge-<username>.roadrape.com`.
2. Diesen TXT-Record genauso bei deinem Registrar eintragen.
3. Zurück in GitHub auf "Verify" klicken.

### Wichtig

- **TTL niedrig halten** (z.B. 300s / 5 Minuten), solange du testest — danach kannst du sie wieder hochsetzen.
- Lösche/ändere **keinen** anderen `CNAME`-Eintrag auf `@` (Apex) — Apex-Domains dürfen laut DNS-Standard keinen CNAME haben, nur die vier A-Records.
- Manche Registrare bieten statt normalen A-Records ein "ALIAS" oder "ANAME" für die Apex-Domain an — falls verfügbar, kannst du das alternativ auf `<dein-github-username>.github.io` zeigen lassen, das funktioniert genauso.

## 4. Warten & HTTPS aktivieren

1. DNS-Propagation dauert normalerweise ein paar Minuten, kann in Einzelfällen bis zu 24h dauern. Prüfen z.B. mit `dig roadrape.com` oder auf whatsmydns.net.
2. Sobald GitHub die Domain als verifiziert anzeigt (grünes Häkchen unter Settings → Pages), aktiviere **"Enforce HTTPS"**. GitHub stellt automatisch ein kostenloses Let's-Encrypt-Zertifikat aus (kann nochmal ein paar Minuten dauern).
3. Fertig — `https://roadrape.com` sollte jetzt das Spiel laden.

## Multiplayer-Hinweis

Der Online-1v1-Modus läuft komplett über WebRTC (Peer-to-Peer) mit PeerJS' kostenlosem Cloud-Signaling-Server — dafür ist **kein eigener Server nötig**, das läuft direkt aus den beiden Spieler-Browsern heraus, sobald die Seite auf GitHub Pages liegt. In seltenen Fällen (sehr restriktive Firmen-/Hotel-Netzwerke) kann eine strikte Firewall die direkte P2P-Verbindung blockieren — das ist eine bekannte Grenze von reinem P2P ohne TURN-Server und für ein Spiel unter Freunden meist kein Problem.
