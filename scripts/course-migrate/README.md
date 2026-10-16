# Kursrutinen — ett Kajabi-kurs inn i en World

Bygger hvert kurs som et **produkt etter produktmalen** (samme form som «The BOLD vest»), i Stines
egen lagring og egen D1. Hører til planen `_project/SODESIGN_APEX_PLAN.md` (S2 produktside, S5
salgsside, S6 medlemsside, S7 leksjon) og UX-anbefalingene i graf `6e6ca7de` (ux2, ux9, ux11, ux12).

## Hva kurset blir (kursgrafen i World-en)

| Node | Innhold | Brukes av |
|---|---|---|
| `produkt` | `metadata.product`: kind `course`, status, tilgang (medlemskap eller pris), kategori, nivå, antall steg, lengde, `grants` (kurset + PDF-er) | nettbutikk, tilgang, kort |
| `kursbilde` (`portfolio-image`) | et representativt bilde fra første video | kurskort, katalog |
| `Om kurset` | slagord, beskrivelse, du strikker, passer for, nivå, dette trenger du, stegene, stikkord, hashtags | produktside, salgsside, kurskort |
| `Steg N av M – <leksjon>` | per leksjon: **Om steg N** (oppsummering med tidspunkter) → **video** → **transkripsjon**; tekstleksjoner med PDF-lenke | medlemsside, leksjonsside |

## Trinn

| # | Trinn | Hvem | Hvordan |
|---|---|---|---|
| 1 | Velg kurs | arkitekten | navn eller Kajabi-kategori |
| 2 | Leksjonsliste | Claude i Chrome | medlemsportalen `stineoksvolddesign.no/products/den-lille-strikkeskolen` → kategoriens poster i rekkefølge (id, tittel, video/tekst) |
| 3 | Last ned | Claude i Chrome | per video: `app.kajabi.com/admin/posts/<id>/edit` → **Video actions → Download video** (åpner S3-fane; lagres som fil) · per tekstleksjon: Downloads-feltet → **Download** (PDF). Filene flyttes til `/Volumes/T7/Kajabi/video/<skole>/<kurs>/` med navn `<lesson_id>-<slug>.mp4`, og en `.json` med sha256 |
| 4 | Manifest | Claude | `scripts/course-migrate/<kurs>.json`: World, slug, tittel, album, mappe, metaArea, `glossary`, `product`, kilde, `videoDir`, leksjoner i rekkefølge (`pdf` på tekstleksjoner) |
| 5 | Kjør | Claude | `zsh scripts/course-migrate/run.sh scripts/course-migrate/<kurs>.json` |
| 6 | Kontroll | Claude, så arkitekten | grafen leses tilbake; `/view` i Chrome; bildeappen som Stine |

`run.sh` gjør alt etter nedlasting, og kan kjøres på nytt når som helst:

1. **komprimer** (CRF 20 → 23 → 26 til under 95 MB, faststart)
2. **last opp** til `<mappe>/NN-<slug>.mp4` i albumet, med metadata på fila; albumet eies av founderen
3. **sjekk** at hver video svarer på byte-ranges (iPhone)
4. **transkriber** (Whisper, norsk) — ordlista `glossary/<navn>.json` retter feilhøringer og fjerner oppdiktede linjer
5. **oppsummer** hver video (punkter med tidspunkt, stikkord, hashtags)
6. **PDF-er** til `<mappe>/<navn>.pdf`
7. **kursbilde** og **Om kurset**
8. **kursgrafen** i World-en

## Gjenbruk og kostnad

Alt lagres i `state/<kurs>.json`. Opplasting skjer på nytt bare når fila endres, Whisper bare når
videoen endres, og oppsummering og beskrivelse bare når instruksjonen eller teksten de bygger på
endres. Et nytt ordpar i ordlista når alle kurs ved neste kjøring uten ny transkripsjon.

## Åpent

- Videoer og PDF-er er offentlige på `cdn.sodesign.no` til medlemstilgang er bygget.
- Steg 2–3 krever innlogget Chrome; de kan ikke kjøres uten Claude.
