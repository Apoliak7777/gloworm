<div align="center">

[![Slovencina](https://img.shields.io/badge/SK-Sloven%C4%8Dina-2ea043?style=for-the-badge)](README.sk.md) [![English](https://img.shields.io/badge/EN-English-30363d?style=for-the-badge)](README.md)

</div>

# GLOWORM — Neónová aréna 🐍✨

Multiplayerová hadia aréna v prehliadači, v reálnom čase. Zbieraj žiariace orby, prerastaj súperov a preži prázdnotu.

[![CI](https://github.com/Apoliak7777/gloworm/actions/workflows/ci.yml/badge.svg)](https://github.com/Apoliak7777/gloworm/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61dafb?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-R3F-000000?logo=threedotjs&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-realtime-010101?logo=socketdotio&logoColor=white)
![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933?logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

Postavené na **React Three Fiber**, **Three.js**, **Socket.IO**, **Zustand** a **TypeScript** (striktný režim).

## Funkcie

### Hrateľnosť
- ⚡ Multiplayer v reálnom čase cez WebSockets (serverový tick 20 Hz)
- 🤖 **AI hady zapĺňajú arénu** — nikdy prázdna lobby a bežia na *tej istej*
  zdieľanej simulácii ako ľudskí hráči, takže sa pohybujú a zatáčajú identicky
- 🎯 Predikcia na strane klienta — tvoj had reaguje okamžite, žiadny vstupný lag
- 🧭 Pohyb nezávislý od snímkovej frekvencie — dĺžka hada je rovnaká pri 30 FPS aj 144 FPS
- 🚀 Boost mechanika — vymeň dĺžku za rýchlosť a nechávaj za sebou orby
- 💀 Smrť rozsype tvoje telo ako zbierateľné orby pre všetkých ostatných
- ⚔️ Priradenie zabití — feed ukazuje, kto koho zjedol, overené na serveri
- 🏆 Živý rebríček, radar na minimape a kill feed

### Doladenie
- 🌈 Neónová 3D grafika s bloom + vignette post-processingom a hviezdnym poľom
- 👀 Hady majú oči, ktoré sa pozerajú tam, kam idú
- 🎆 Časticové výbuchy pri smrti ľubovoľného hada
- 🔊 Syntetizované zvukové efekty (Web Audio — nula zvukových súborov), stlmiteľné
- 🎨 Vyber si svoju neónovú farbu pred spawnom
- 📈 Sledovanie osobného rekordu a poradia (uložené lokálne)
- 📱 Dotykové ovládanie na mobile, klávesnica na počítači

### Technické riešenie
- 🛡️ Validácia pohybu a skóre na strane servera s resyncom po výpadku, odolná
  voči poškodeným payloadom a podvrhnutiu skóre
- 📉 **Delta-synchronizované orby** — orby sú statické, kým ich niekto nezje, takže sa posielajú raz a
  potom už len ako udalosti pridania/odobrania. Namerané: **888 KB/s → 9 KB/s na klienta (-99 %)**
- 📦 Zaokrúhlené súradnice, krátke base36 id, obmedzené počty entít
- ⚙️ Inštancované vykresľovanie s explicitnými rozsahmi GPU aktualizácií (nahráva sa len to, čo sa zmenilo)
- 🧪 Jadro simulácie pokryté unit testami (Vitest) — nezávislosť od snímkovej frekvencie a
  invariant tlmenia zatáčania sú overené, nielen deklarované
- 🔒 Striktný TypeScript všade, zdieľané typy medzi klientom a serverom
- 🐳 Súčasťou je Dockerfile + GitHub Actions CI

## Stiahni a hraj

Stiahni si **`gloworm-windows-x64.exe`** z [posledného vydania](https://github.com/Apoliak7777/gloworm/releases/latest) a dvakrát na neho klikni. Žiadna inštalácia, žiadny Node.js, nič netreba nastavovať — server sa spustí, prehliadač sa otvorí a AI hady sú už v aréne.

Vypíše aj LAN adresu, takže ktokoľvek v tvojej sieti sa môže pripojiť do tej istej hry otvorením daného odkazu.

## Rýchly štart (zo zdrojového kódu)

**Požiadavky:** Node.js 20+

```bash
# Inštalácia závislostí
npm install

# Spustenie vývojového servera (frontend + backend na jednom porte)
npm run dev
```

Otvor [http://localhost:3000](http://localhost:3000). Otvor druhú kartu a otestuj multiplayer.

## Ovládanie

| Vstup | Akcia |
|-------|-------|
| `A` / `←` (podržať) | Plynulé zatáčanie doľava |
| `D` / `→` (podržať) | Plynulé zatáčanie doprava |
| `Space` / `Shift` / `W` / `↑` | Boost (spaľuje dĺžku) |
| **Myš** | Mierenie: smeruj ku kurzoru |
| **Ľavé kliknutie** (podržať) | Boost |
| Dotyk ◀ ▶ / Boost | Mobilné ovládanie |

**Podrž a zatáčaj.** Podržanie `D` točí hada v smere hodinových ručičiek, kým klávesu držíš — celý kruh trvá približne 1,4 sekundy. Rotáciu poháňa model uhlovej rýchlosti, takže had do oblúka *zrýchľuje* a z neho *doplachtí*, namiesto skokového zapínania a vypínania.

Myš je alternatívna schéma absolútneho mierenia a nikdy neprevezme kontrolu, kým je stlačená klávesa zatáčania. Správanie je [pokryté unit testami](src/shared/gameLogic.test.ts): konštantná rýchlosť otáčania počas držania, plynulý nábeh a doplachtenie a identický oblúk pri 30, 60 aj 144 FPS.

Polomer otáčania (~4,1 jednotky) je zámerne vyladený voči vlastnej dĺžke hada a náraz do vlastného tela ťa **nezabije** — pravidlá ako v slither.io. Držanie zatáčky je hlavný ovládací prvok, takže smrť za jeho použitie by bola dizajnová chyba. Ak chceš pravidlá klasického Snake, prepni `SELF_COLLISION_ENABLED` v `src/shared/types.ts`.

## Produkcia

```bash
npm run build
npm run start
```

Nastav `PORT` na zmenu portu servera (predvolene `3000`).

### Docker

```bash
docker build -t gloworm .
docker run -p 3000:3000 gloworm
```

## Štruktúra projektu

```
├── server.ts              # Express + Socket.IO herný server (validácia, orby, boti, rebríček)
├── src/
│   ├── components/        # React Three Fiber scéna a HTML UI
│   ├── hooks/             # Spracovanie vstupu z myši/klávesnice/dotyku
│   ├── shared/            # Typy, herná logika a AI botov zdieľané klientom a serverom
│   │   ├── gameLogic.ts   # Čisté jadro simulácie (poháňa aj botov)
│   │   ├── gameLogic.test.ts
│   │   └── botBrain.ts    # Rozhodnutia AI o zatáčaní
│   ├── store/             # Zustand store + Socket.IO klient
│   └── utils/             # Syntetizované zvukové efekty
```

## Testovanie

```bash
npm test          # jednorazové spustenie sady testov
npm run test:watch
npm run typecheck
```

## Ako to funguje

```
┌──────────┐  update_state (20/s)  ┌──────────┐
│  Client   │ ────────────────────▶ │  Server  │   validuje pohyb,
│ (predicts │ ◀──────────────────── │ (Node +  │   vlastní orby a rebríček,
│  locally) │    state (20 Hz)      │ Socket.IO)│   vysiela stav sveta
└──────────┘                        └──────────┘
```

- **Server** vlastní hráčske relácie, spawnovanie orbov, rebríček a validuje každú aktualizáciu pohybu (maximálna rýchlosť, delta skóre, hranice). Po výpadku spojenia klienta resynchronizuje namiesto toho, aby ho zamrazil.
- Každý **klient** počíta lokálnu fyziku pre vlastného hada a synchronizuje sa pri 20 Hz. Segmenty sa ukladajú pozdĺž dráhy hlavy s pevnými rozostupmi, takže dĺžka hada nikdy nezávisí od snímkovej frekvencie.
- Ostatní hráči sú interpolovaní kvôli plynulému vykresľovaniu; ich hlavy sa otáčajú plynulo cez lerp uhla najkratším oblúkom.
- Pri smrti sa telo hada premení na orby a udalosť `player_died` napĺňa kill ticker.

## Licencia

MIT
