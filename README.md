# RoonWishlist

Roon Extension — ostoslista albumeille joita ei vielä omista häviöttömänä.

## Toiminta

- **Wishlist**: Lisää albumeja ostoslistaan Roonista
- **Haku**: Etsii albumin Bandcampilta ja Qobuzilta
- **Auto-clean**: Kun lossless-tiedostot löytyvät lokaalikirjastosta, albumi poistuu automaattisesti ostoslistasta

## Asennus

```bash
npm install
```

## Käynnistys

```bash
node index.js
```

Käynnistyksen jälkeen:
1. Avaa Roon → Settings → Extensions → **Wishlist** → Enable
2. Aseta Settings-kohdasta `Music library path` (esim. `D:\Music`)

## HTTP API (port 3141)

| Metodi | Polku | Kuvaus |
|--------|-------|--------|
| GET | `/wishlist` | Hae kaikki wishlist-albumit |
| POST | `/wishlist/add` | Lisää albumi `{"artist":"...","title":"..."}` |
| POST | `/wishlist/remove` | Poista albumi `{"artist":"...","title":"..."}` |
| GET | `/search?artist=&title=` | Hae ostoslinkit Bandcampilta/Qobuzilta |
| POST | `/check-lossless` | Tarkista kirjasto ja siivoa wishlist |

## Projektirakenne

```
index.js              ← Roon extension + HTTP API
src/
  wishlist.js         ← Wishlist CRUD (data/wishlist.json)
  search.js           ← Bandcamp & Qobuz -haku
  lossless_checker.js ← Kirjaston tarkistus, auto-remove
data/
  wishlist.json       ← (luodaan automaattisesti, ei commitoida)
```
