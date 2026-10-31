# 👕 Kledingkast

Inventaris van de kleding van het hele gezin. Foto maken, maat en gegevens invullen, en de app sorteert en filtert. Draait op een eigen server, zodat foto's en gegevens bij jou blijven.

## Wat het doet
- **Foto's** per kledingstuk (tot 6), op je telefoon automatisch verkleind
- **Gegevens:** naam, categorie, kleur, maat, merk, seizoen, materiaal, plek in de kast, prijs, aankoopdatum, tags, notities, van wie
- **Kleur uit de foto** wordt automatisch voorgesteld, zonder AI
- **AI-herkenning (optioneel):** naam, categorie, kleur, seizoen, materiaal en merk worden voorgesteld uit de foto. Je past alles zelf aan
- **Filteren en sorteren** op categorie, van wie, seizoen, kleur, maat, minst/meest gedragen
- **Gedragen-teller:** één tik op "Vandaag gedragen". Zo zie je wat je vaak draagt, de prijs per keer, en wat je al een half jaar niet meer hebt aangehad
- **Status:** in de kast, in de was, weggegeven (handig voor kinderkleding die te klein wordt)
- Export naar CSV, werkt als app op het beginscherm (PWA)

## Installeren op je server (Docker)
```bash
git clone https://github.com/Jlmree/Boeken-inventaris.git kledingkast
cd kledingkast
cp .env.example .env      # pas FAMILY_PASSWORD en MEMBERS aan
docker compose up -d --build
```
De app luistert op `127.0.0.1:3000`. Zet er een reverse proxy met https voor, want de camera en de login-cookie hebben https nodig. Met Caddy is dat:
```
kleding.jouwdomein.nl {
    reverse_proxy 127.0.0.1:3000
}
```
Open daarna `https://kleding.jouwdomein.nl` op je telefoon en kies *Zet op beginscherm*.

### Zonder Docker
Je hebt Node.js 22.13 of nieuwer nodig. Er zijn geen npm-pakketten nodig.
```bash
FAMILY_PASSWORD=geheim node server/server.js
```

## AI-herkenning aanzetten
Maak een sleutel op [console.anthropic.com](https://console.anthropic.com) en zet hem in `.env` bij `ANTHROPIC_API_KEY`. Daarna verschijnt de knop **✨ Herken met AI** zodra je een foto toevoegt, en wordt de eerste foto automatisch herkend. De foto wordt dan naar Anthropic gestuurd; zonder sleutel verlaat niets je server. Het standaardmodel (`claude-haiku-5-5`) is het kleinste en snelste model; je betaalt per herkende foto, kijk de actuele prijzen na in je Anthropic-account. Met `AI_MODEL` kun je een ander model kiezen.

## Back-up
Alles staat in de map `data/`: de database (`kast.db`) en de foto's. Maak daar regelmatig een kopie van, bijvoorbeeld:
```bash
tar czf kledingkast-$(date +%F).tgz data/
```

## Beveiliging
- Eén gezinswachtwoord. Na inloggen blijft elk toestel 90 dagen ingelogd (`SESSION_DAYS`)
- Foto's en gegevens zijn alleen na inloggen te zien
- Inloggen wordt afgeremd na 8 pogingen per minuut
- Zet altijd https voor de app

## Ontwikkelen
```bash
npm test                                   # servertests
FAMILY_PASSWORD=test node server/server.js # draait op http://localhost:3000
```
