# Projekt-brief: Mad & Kalorier

Dette er en overdragelses-note fra en tidligere Claude-session (i Claude.ai), hvor vi
designede og byggede v1 af dette projekt. Formålet med denne fil er at give Claude Code
fuld kontekst, så vi kan fortsætte uden at gentage beslutninger.

## Hvad appen er

En personlig webapp (ikke en native/mobil app) til at:

- Scanne stregkoder på madvarer med telefonens kamera og automatisk hente
  næringsindhold fra Open Food Facts, og gemme dem som "ingredienser"
- Bygge "madretter" (recipes) af ingredienser + mængder, med automatisk beregnet kalorietal
- Planlægge en ugeplan (7 dage × 4 måltider: Morgenmad/Frokost/Aftensmad/Snack) og se
  dagens samlede kalorier op mod et personligt kaloriemål

Kun til privat/personligt brug — ikke en produkt-app til andre brugere. Ingen login-system
er bygget endnu (se "Kendte begrænsninger" nedenfor).

## Beslutninger der er taget (og hvorfor)

1. **Website i stedet for native app.** Bruger valgte dette i stedet for React
   Native/Flutter, fordi det er simplere at bygge/hoste og kameraadgang i browseren er
   fuldt tilstrækkeligt til stregkodescanning.
2. **Vanilla JS, intet framework.** v1 var rå HTML/CSS/JS i én fil uden build-step.
   *Opdateret:* bruger har valgt Vite som build-værktøj med supabase-js og barcode-detector
   som npm-pakker (for env-variabler, låste versioner og dev-server). CSS og JS ligger
   nu i `src/`. Stadig intet framework — skift ikke til React/Vue/osv. uden at spørge.
3. **Supabase som backend.** Valgt fordi bruger ønskede data synkroniseret mellem
   telefon og computer (ikke kun `localStorage`), og fordi Supabase er gratis til dette
   volumen og kræver ingen server-kode — kun `supabase-js` fra klienten.
4. **Ny, separat Supabase-projekt.** Bruger har allerede et andet Supabase-projekt
   forbundet til deres GitHub fra et andet projekt. Vi besluttede at oprette et NYT,
   separat Supabase-projekt til denne app for at undgå at blande skemaer. Antag IKKE at
   det eksisterende projekt skal genbruges.
5. **Open Food Facts som ernæringsdata-API.** Gratis, ingen API-nøgle, globalt data.
   `FatSecret` blev overvejet men afvist til v1, fordi deres gratis tier kun dækker
   amerikanske stregkoder — irrelevant for en dansk bruger. Kan genovervejes senere hvis
   Open Food Facts-dækningen er for tynd for danske produkter.
6. **barcode-detector** (npm-pakke; zxing-cpp som WASM) læser stregkoder fra
   kamera-feedet. Erstattede html5-qrcode, som ikke kunne læse stregkoder på mobil,
   fordi den kun afkoder et nedskaleret udsnit (~250 px bredt) af kamerabilledet.
   WASM-filen serveres fra sitet selv, ikke fra en CDN.
7. **Repo og deployment:** privat GitHub-repo, deploy via **Vercel** (valgt af bruger)
   med auto-deploy on push til `main`. Supabase kan ikke selv hoste sitet, da Storage og
   Edge Functions serverer HTML som `text/plain`.
8. **UI: mobil-først, intet komponentbibliotek.** Ionic/Shoelace blev fravalgt (tunge og
   uden de mobilmønstre, der skal bruges). Egne komponenter i vanilla JS/CSS, ikoner fra
   `lucide` og skrifttypen Plus Jakarta Sans via `@fontsource-variable`. Mobil: fanebar i
   bunden, bottom sheets, én dag ad gangen i ugeplanen. Fra 700 px: faner i toppen,
   centrerede dialoger og flere kolonner. Lyst/mørkt tema følger systemet.
9. **Billeder af madretter i Supabase Storage.** Offentlig bucket `madret-billeder` og
   kolonnen `madretter.billede_sti` (stien i bucketten, ikke en URL). Billeder skaleres
   til maks. 1280 px og gemmes som JPEG i browseren før upload. Ny sti ved hver upload,
   gamle filer slettes.
10. **Portioner og mængder i ugeplanen.** En madret kan have antal portioner og færdigvægt
    (vægten af den tilberedte ret – kogt pasta vejer mere end tørvaren). Uden færdigvægt
    bruges ingrediensernes samlede vægt. I ugeplanen angives mængden i gram eller portioner;
    kcal = mængde / færdigvægt (eller / portioner) × rettens kcal. Mangler retten portioner
    eller færdigvægt, kan de angives direkte i ugeplanen og gemmes på retten. Madretter
    åbnes ved tryk på kortet og redigeres i samme bygger, som bruges til at oprette dem.
    Mangler databasen nye kolonner (setup.sql ikke kørt igen), viser appen en besked om det.
11. **Kladder i databasen, ikke i browseren.** Lukkes byggeren for en ny ret (eller en kladde)
    med ændringer, gemmes den som `madretter.kladde = true`, så den kan fortsættes på en
    anden enhed. Kladder vises med stiplet kant i listen, men aldrig i ugeplanen. En tømt
    kladde slettes. "Ny madret" starter altid forfra. Ændringer i en færdig ret gemmes kun
    med "Gem ændringer".
12. **Retter har ingen kategori** – alle retter kan vælges til alle måltider, og valg-arket
    i ugeplanen har søgning. Ingredienser kan redigeres (tryk på kortet), har en valgfri
    producent, og byggeren kan vise alle ingredienser sorteret efter navn eller senest oprettet.

## Filer

- `index.html` — app-skal, de tre visninger og dialoger (sheets, bekræftelse, scanner).
- `src/main.js` — starter appen: styles, Supabase-forbindelse og opsætning af visninger.
- `src/state.js` — fælles data (`store`) og alle Supabase-kald. Visningerne kalder kun
  funktionerne herfra og gentegner via `subscribe()`.
- `src/views/` — `ingredienser.js` (liste, søgning, formular, Open Food Facts-opslag),
  `madretter.js` (oversigt med filtre, bygger med ingredienssøgning), `ugeplan.js`
  (dagskort, valg af madret, kaloriemål).
- `src/scanner.js` — kamera og stregkodeafkodning.
- `src/lib/` — ikoner (Lucide), formatering/søgning, toasts/dialoger, faner, HTML-skabeloner,
  nedskalering af billeder før upload (`image.js`).
- `src/styles/` — `base.css` (designtokens, lyst/mørkt tema), `layout.css`, `components.css`,
  `sheets.css`, `views.css`.
- `public/favicon.svg` — app-ikon.
- `vite.config.js` — stopper `vite build`, hvis Supabase-variablerne mangler.
- `supabase/setup.sql` — SQL til at oprette alle tabeller + RLS-policies. Skal køres i
  Supabase SQL Editor på det NYE Supabase-projekt (køres ikke automatisk).

## Datamodel (allerede oprettet via SQL-scriptet)

```
ingredienser
  id uuid pk, navn text, barcode text, kcal_100g numeric,
  protein_100g numeric, fedt_100g numeric, kulhydrat_100g numeric, created_at,
  producent text  -- valgfri, fx fra Open Food Facts

madretter
  id uuid pk, navn text, created_at, kladde boolean (default false),
  billede_sti text, portioner numeric, faerdig_vaegt_g numeric,  -- valgfrie
  kategori text  -- ubrugt: retter kan bruges til alle måltider (kolonnen er bevaret, ikke slettet)

madret_ingredienser  (join-tabel, mange-til-mange med mængde)
  id uuid pk, madret_id -> madretter.id (cascade delete),
  ingrediens_id -> ingredienser.id (cascade delete), maengde_g numeric

ugeplan
  id uuid pk, dag text (Mandag..Søndag), maaltid text (samme 4 kategorier),
  madret_id -> madretter.id (set null ved delete), unique(dag, maaltid),
  maengde numeric, enhed text (g|portion)  -- begge tomme = hele retten

indstillinger
  id int pk (altid 1), kalorie_maal numeric  -- ét globalt dagligt kaloriemål
```

## Konfiguration (miljøvariabler)

Supabase-URL og anon key ligger IKKE i koden (besluttet af bruger). Vite læser dem fra
`VITE_SUPABASE_URL` og `VITE_SUPABASE_ANON_KEY` (kun `VITE_`-variabler sendes med til
browseren).

- Kræver Node 22 (se `.nvmrc`). Vite 8 virker ikke på Node under 20.19.
- Lokalt: `npm install`, kopiér `.env.example` til `.env`, udfyld og kør `npm run dev`
  (genstart efter ændringer i `.env`).
- Vercel: genkender Vite automatisk (build `npm run build`, output `dist`). Sæt de to
  variabler under Project Settings → Environment Variables.

Bemærk: anon key er beregnet til at være offentlig og ender i browseren uanset hvad.
Env-variabler holder den ude af Git, men beskytter ikke data. Det gør kun RLS.

## Kendte begrænsninger / ting der bør adresseres videre

- **RLS-policies er helt åbne** (`using (true) with check (true)` på alle tabeller).
  Det er acceptabelt for et rent personligt projekt, MEN betyder at alle der har URL +
  anon key kan læse/skrive hele databasen. Anbefaling givet til bruger: hold GitHub-repo
  privat OG hold den deployede URL uindekseret/ikke delt. En rigtig løsning (Supabase
  Auth + RLS-policies der tjekker `auth.uid()`) er ikke bygget endnu — spørg brugeren om
  dette er noget de vil prioritere nu eller senere.
- **Ingen automatiserede tests.**
- **Ingen CI/CD er sat op endeles** — det er formentlig det næste skridt (se nedenfor).
- **Ingen offline-håndtering.** Fejl vises som toasts, men der er ingen kø eller genforsøg.
- **Ugeplanen er pr. ugedag, ikke pr. dato**, og har én madret pr. måltid.
- **iPhones med flere linser kan ikke fokusere helt tæt på.** Stregkoden skal holdes
  ca. 15–20 cm fra kameraet (står også som hjælpetekst i scanneren).
- Appen er **ikke testet i en rigtig browser** endnu (kun syntax-valideret). Første
  opgave i det nye repo bør være at faktisk teste flowet end-to-end: tilføj ingrediens,
  scan en stregkode, byg en madret, udfyld en ugeplan.

## Hvad bruger har bedt om lige nu

1. Opret et nyt GitHub-repo, klon det i VS Code
2. Sæt Claude Code (dette workflow) til at overtage videre udvikling
3. Byg en CI/CD-løsning til hjemmesiden (auto-deploy on push)

## Forslag til første opgaver for Claude Code

1. Initialisér repo-struktur:
   ```
   mad-kalorier/
   ├── index.html
   ├── supabase/setup.sql
   ├── README.md
   └── .gitignore
   ```
2. Bekræft med brugeren: nyt Supabase-projekt er oprettet, og `setup.sql` er kørt der.
3. Sæt Supabase-nøglerne ind (spørg brugeren om de vil have dem hardcoded i
   `index.html` som i v1, eller om det er værd at introducere et minimalt build-step nu
   for at holde dem i en `.env`-fil / injicere dem ved build-time — begge er gyldige,
   men det er en bevidst beslutning bruger skal tage, ikke noget der skal antages).
4. Sæt CI/CD op:
   - Anbefalet: forbind repoet til Vercel eller Netlify, sæt auto-deploy på push til
     `main`. Confirm med bruger hvilken af de to de foretrækker (ingen af dem er valgt
     endnu).
   - Hvis env-vars introduceres i punkt 3, sæt dem op i Vercel/Netlify's dashboard, ikke
     i koden.
5. Test hele flowet på en rigtig telefon via den deployede HTTPS-URL (kamera-adgang
   kræver HTTPS, virker ikke ved at åbne filen lokalt).
6. Tag stilling til RLS/adgangskontrol-spørgsmålet ovenfor, hvis bruger ønsker det
   adresseret nu.

## Ting Claude Code IKKE bør gøre uden at spørge først

- Skifte fra vanilla JS til et framework (React/Vue/osv.)
- Genbruge brugerens eksisterende Supabase-projekt til dette skema
- Ændre datamodellen (kolonnenavne, tabelstruktur) uden at bruger er indforstået, da
  det allerede er sat op og kørt i Supabase
- Gøre RLS-policies strammere/tilføje auth uden at spørge, da det er en UX-ændring
  (kræver login) og ikke kun en teknisk detalje
