# 📚 Boekenkast

Gezins-inventaris van boeken. Scan de barcode (ISBN) met je telefoon en titel, auteur en cover worden automatisch opgezocht (Google Books, daarna Open Library).

- Scannen met de camera, een foto, of ISBN intypen
- Overzicht met covers, zoeken, filteren (gelezen / ongelezen / uitgeleend / geleend), sorteren
- Categorie (Fictie, Non-fictie, Kinderboeken, …) en genre per boek, automatisch voorgesteld en te wijzigen; filteren op beide
- Per boek: van wie, gelezen (door wie), uitgeleend aan / geleend van (met datum), notities
- Dubbelen worden herkend bij het scannen
- Werkt als app op je telefoon (PWA) en op de computer, ook offline
- Delen met het gezin via Supabase (gratis), export naar CSV

Geen build-stap: het zijn gewone statische bestanden.

## Uitproberen
```bash
python3 -m http.server 8000   # open http://localhost:8000
```
Camera werkt alleen via `https://` of `localhost`.

## Online zetten (voor je telefoon)
GitHub: **Settings → Pages → Deploy from branch** (`main`, map `/`). Open de link op je telefoon en kies *Zet op beginscherm*.

## Gezin laten delen (5 minuten)
1. Maak een gratis project op [supabase.com](https://supabase.com).
2. Plak `supabase/schema.sql` in **SQL Editor** en klik *Run*.
3. Kopieer onder **Project Settings → API** de *Project URL* en de *anon public key*.
4. Open de app → **Instellingen** → vul URL, key en een zelfverzonnen **gezinscode** in.
   (Of zet ze vast in `config.js`, dan is iedereen meteen gekoppeld.)
5. Op elk toestel dezelfde gezinscode invullen. Boeken verschijnen overal.

De gezinscode werkt als wachtwoord: de database geeft alleen boeken terug aan wie de code meestuurt. Kies dus iets lastigs te raden.
Zonder Supabase blijven de boeken lokaal op het toestel staan.
