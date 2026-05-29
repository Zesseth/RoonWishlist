# TODO — RoonWishlist (agentin työlista)

> Tämä on **agentin oma työmuisti**. Ylläpidä jatkuvasti (ks. `AGENTS.md`).
> Päivitä tilat heti kun status muuttuu, ja kirjaa esteet + seuraava askel.

**Tilamerkinnät:** `[ ]` tekemättä · `[~]` kesken · `[x]` valmis · `[!]` estynyt

Viimeksi päivitetty: 2026-05-29

---

## Valmis (done)

- [x] **Initial commit & push** — koodi viety `Zesseth/RoonWishlist` (main).
- [x] **Lisensointi** — `AGPL-3.0-or-later` (`LICENSE`) + Roon-erityislupa
  credittejä vastaan (`ADDITIONAL-GRANTS.md`). `package.json` `license`-kenttä
  päivitetty. README + AGENTS.md viittaavat.
- [x] **Repo julkiseksi** — `Zesseth/RoonWishlist` asetettu publiciksi.
- [x] **`main`-branch suojattu** — suorat pushit estetty, muutokset PR:ien kautta;
  omistaja säilyttää kontrollin.
- [x] **AGENTS.md** — projektikohtainen ohjeistus (henkilökohtainen projekti,
  TODO.md:n ylläpitovelvoite, työnkulkusäännöt).

---

## Backlog — varsinainen kesken jäänyt toteutus

Kukin kohta vastaa GitHub-issueta (numerot lisätään kun issuet on luotu).

- [ ] **#? Roon-kirjastointegraatio (CORE).** Tällä hetkellä extension tarjoaa
  vain settings + HTTP API:n; ei oikeaa Roon-integraatiota. Lisää
  `node-roon-api-browse` (ja tarvittaessa `-transport`), jotta:
  - käyttäjä voi lisätä albumin wishlistiin suoraan Roonista, ja
  - kirjaston luku tapahtuu Roonin kautta, ei pelkän lokaalin polun perusteella.
  Tämä on pahiten kesken oleva osa.

- [ ] **#? Automaattinen ajastettu lossless-tarkistus.** Nyt vain manuaalinen
  `POST /check-lossless`. Lisää ajastin (esim. konfiguroitava intervalli) ja/tai
  tiedostojärjestelmän watch, joka ajaa `checkAndClean`-funktion automaattisesti.

- [ ] **#? Hakuproviderien vakautus (Bandcamp/Qobuz).** `src/search.js` perustuu
  HTML-scrapeen; Qobuz-selektorit ovat arvauksia ja hauras. Selvitä
  vakaammat rajapinnat/strategiat, lisää retry/timeout/caching ja virheenkäsittely.

- [ ] **#? Datakerroksen kovennus.** `data/wishlist.json`: atominen kirjoitus,
  vakaa skeema + item-id:t, dedup-reunatapaukset, mahdollinen migraatio.

- [ ] **#? Web-käyttöliittymä wishlistin hallintaan.** Roonin settings-UI on
  rajallinen → tarjoa pieni frontti HTTP-API:n päälle (listaus, lisäys, poisto,
  haku, manuaalinen check).

- [ ] **#? Testit.** Yksikkötestit: `wishlist` (CRUD/dedup), `lossless_checker`
  (matchaus + auto-remove, mockattu fs), `search` (mockattu HTTP). Valitse kevyt
  testirunner (esim. node:test) ja lisää `npm test`.

- [ ] **#? CI (GitHub Actions).** Workflow: asennus + lint + testit PR:issä ja
  mainiin mergeissä. Vaatii `workflow`-scopen (on jo tokenilla).

- [ ] **#? Konfigurointi & lokitus.** Konfiguroitava portti, log-tasot,
  ympäristömuuttuja-/asetustuki, siisti virhelokitus.

- [ ] **#? Jakelu & dokumentaatio.** Ohjeet asennukseen Roon-extensioksi,
  versiointi/release-prosessi, mahdollinen extension-manager-merkintä.

---

## Esteet & huomiot (blockers / notes)

- **GitHub Projects (v2) -board:** nykyiseltä `gh`-tokenilta puuttuu `project`-scope
  (scopet: gist, read:org, repo, workflow). Boardin luonti vaatii käyttäjältä:
  `gh auth refresh -s project -s read:project`. Siihen asti suunnitelma elää
  epic-/tracking-issuena + milestonena.

---

## Työohje agentille

1. Tee työ feature-branchissa, avaa PR mainiin (main on suojattu).
2. Älä committaa/pushaa ilman käyttäjän lupaa; ei AI-tekijyysmerkintöjä.
3. Päivitä tämä tiedosto + vastaava GitHub-issue jokaisen edistysaskeleen jälkeen.
