# Návrh notifikačného systému

Diagram: `notification-navrh-claude.drawio` (3 strany: naivná verzia, async + cache, finálny návrh s auditom).

## Zadanie v skratke

- **Vstup 1:** CRUD operácie nad používateľom (`/user`).
- **Vstup 2:** `POST /notification` s `{ userId, type }`, typ je SMS / EMAIL / PUSH.
- **Priepustnosť:** v zadaní (diagram) 1 000 000 / 10 s = **100 000 správ/s**. Ústne zaznelo aj 10 000 000 / 10 s = **1 000 000 správ/s**. Overiť ako prvé, mení to voľbu technológií.
- **Doplnená požiadavka:** každá notifikácia musí byť v **audit logu**.

**Riešenie v jednej vete:** API notifikáciu prijme, hneď ju zapíše do brokera a vráti `202 Accepted`. Za brokerom sú pre každý kanál samostatné skupiny workerov. Audit je ďalší, nezávislý odberateľ toho istého toku správ.

Technológie vychádzajú z CV: Java/Kotlin, Spring Boot, RabbitMQ, PostgreSQL, MongoDB, InfluxDB, Hazelcast, AWS, Docker/Helm.

---

## Krok 0 – otázky na upresnenie

1. Ide o **špičku alebo trvalú záťaž**? Typicky špička, napríklad hromadná kampaň.
2. **Garancia doručenia:** stačí *at-least-once* (aspoň raz, výnimočne môže prísť duplikát)?
3. **Audit:** ktoré stavy (prijaté / odoslané / doručené / chyba), ako dlho uchovávať, kto a ako sa bude pýtať?
4. **Limity brán:** SMS a email provideri majú vlastné limity, väčšinou oveľa nižšie ako 100 000/s.

## Krok 1 – najjednoduchšia verzia (strana 1 v diagrame)

```
Client ──POST /notification──► Notification API ──► SELECT user (PostgreSQL) ──► sync volanie brány
Client ──CRUD /user──────────► User API ──► PostgreSQL
```

Jedna Spring Boot aplikácia a PostgreSQL. Funguje pre stovky správ za sekundu. **Nestačí** z troch dôvodov:

- každý request čaká na pomalú externú bránu (100+ ms);
- pre každú notifikáciu ide SELECT do DB;
- pri výpadku brány sa správy stratia, chýba zásobník (buffer).

## Krok 2 – asynchrónne spracovanie cez broker (strana 2)

```
Client ─POST─► Notification API ─publish─► RabbitMQ exchange "notifications"
   ◄── 202                                   ├─ sms   ─► SMS workers   ─► SMS gateway
                                             ├─ email ─► Email workers ─► EMAIL gateway
                                             └─ push  ─► Push workers  ─► PUSH gateway
```

- **API je bezstavové** (nič si nepamätá medzi požiadavkami). Overí vstup, pridelí `notificationId`, publikuje správu a vráti 202. Škáluje sa za load balancerom.
- **RabbitMQ:** routovanie podľa `type`, každý kanál má vlastnú frontu.
- **Izolácia kanálov:** keď sa zasekne SMS brána, email a push bežia ďalej.
- **Publisher confirm:** 202 ide klientovi až po tom, čo broker potvrdí uloženie správy. Prijatá správa sa tak nestratí.

### Čo je worker

Worker je **samostatne nasadená, bezstavová služba v Spring Boot (Java/Kotlin)**. Nemá verejné API, iba endpointy pre health a metriky. Číta správy z brokera a posiela ich na bránu.

Čo robí, napríklad SMS worker:

1. Odoberá správy zo svojej fronty (alebo zo svojich partícií streamu).
2. Doplní kontakt používateľa z cache (krok 3), teda telefónne číslo podľa `userId`.
3. Zavolá SMS bránu. Pri chybe to skúša znova s čakaním (retry s backoffom) a dodržiava limity brány (rate limit, circuit breaker).
4. Pošle stavovú udalosť `SENT` alebo `FAILED` pre audit (krok 5).
5. Až potom potvrdí brokeru (ack), že správu spracoval.

Prečo je oddelený od Notification API:

- **API musí byť rýchle.** Iba prijme správu, zapíše ju do brokera a vráti `202`. Pomalú prácu robia workery, lebo brány odpovedajú 100+ ms.
- **Nezávislé škálovanie.** API sa škáluje podľa počtu requestov, workery podľa toho, koľko správ čaká vo fronte (lag).
- **Izolácia kanálov.** Keď sa zasekne SMS brána, zasekne sa iba SMS worker.

Či sú to tri samostatné aplikácie:

| Možnosť | Ako | Kedy |
|---|---|---|
| **A. Jeden kód, tri nasadenia** (odporúčam) | jeden Spring Boot projekt s konfiguráciou `channel=sms\|email\|push`, nasadený trikrát (v Kubernetes tri Deploymenty z jedného Docker image) | spoločný kód (retry, audit, cache, idempotencia) je raz, kanály sú aj tak oddelené |
| **B. Tri samostatné projekty** | `sms-worker`, `email-worker`, `push-worker` | keď sa kanály veľmi líšia alebo ich vlastnia rôzne tímy |

**Ako to povedať:** „Workery sú bezstavové Spring Boot consumery bez HTTP API. Jeden kód, nasadený zvlášť pre každý kanál, autoscaling podľa lagu fronty.“

## Krok 3 – dáta o používateľovi bez dotazu do DB

```
User API (CRUD) ──► PostgreSQL (zdroj pravdy)
      └─ UserCreated / Updated / Deleted ─► broker ─► cache kontaktov vo workeroch (Hazelcast / in-memory)
```

- **Event-carried state transfer:** pri každej zmene používateľa ide udalosť s jeho dátami. Workery si podľa nej udržiavajú vlastnú kópiu kontaktov.
- Používateľov je rádovo menej ako notifikácií, kópia sa zmestí do pamäte.
- Kompromis: kópia môže byť zastaraná o milisekundy. Pri notifikáciách je to v poriadku.
- Alternatíva: API pri prijatí doplní kontakt rovno do správy, workery potom DB nepotrebujú vôbec.

## Krok 4 – priepustnosť (strana 3)

Hrubý odhad pri 500 B na správu:

| Záťaž | Správ/s | Dáta | Za deň |
|---|---|---|---|
| 1M / 10 s | 100 000 | ~50 MB/s | ~4 TB |
| 10M / 10 s | 1 000 000 | ~500 MB/s | ~43 TB |

- **Klasické fronty RabbitMQ:** rádovo desiatky tisíc správ/s na uzol. Pri 100k/s treba viac front podľa hashu `userId` (consistent-hash exchange) a cluster.
- **RabbitMQ Super Streams** (od 3.11): append-only log s partíciami, státisíce až milióny správ/s. Zostávame v známej technológii.
- **Kafka:** pri 1M/s štandardná voľba v praxi. Princíp je rovnaký: partície podľa `userId`, consumer groups, offsety.

### „Podľa hashu userId“ neznamená frontu alebo partíciu pre každého používateľa

Počet front (alebo partícií) je **pevný a malý** (napr. 16–60). Každý `userId` sa do jednej z nich len namapuje:

```
fronta = hash(userId) % počet_front
```

- Pri 1 000 aj pri 100 miliónoch používateľov je front stále rovnako. Na jednu frontu len pripadne viac používateľov. Hash ich rozloží rovnomerne.
- V RabbitMQ to robí **consistent-hash exchange** (plugin, routing key = `userId`), pri Super Streams to robí klient sám podľa kľúča.
- Počet sa volí podľa **priepustnosti a počtu workerov**, nie podľa počtu používateľov.
- **Prečo podľa userId:** správy jedného používateľa idú v poradí a ten istý worker ich vidí všetky (napr. limit SMS na používateľa). Ak to netreba, stačí rozdeľovať správy rovnomerne bez kľúča.
- **Pozor:** neskoršia zmena počtu front presunie časť používateľov inam a na chvíľu poruší poradie. Preto počet s rezervou hneď na začiatku.
- **Dávky:** batch publish/consume a endpoint `POST /notifications/batch` pre kampane.
- **Autoscaling** workerov podľa lagu fronty (koľko správ čaká), na AWS cez ECS/EKS a Helm.

## Krok 5 – audit

Princíp: **audit nesmie spomaliť doručovanie a nesmie nič vynechať.**

```
API ─► stream ──┬─► workers ──► SENT / FAILED / DELIVERED ──► audit-events stream ─┐
  (RECEIVED)    └─► Audit consumer ◄──────────────────────────────────────────────┘
                         └─► batch insert ─► Audit storage ─► archív
```

- **Samostatný odberateľ** (fan-out) zaznamená `RECEIVED`. Workery posielajú `SENT` / `FAILED`. `DELIVERED` prichádza cez callback brány.
- **Append-only záznam** (len pripisovaný, nikdy prepisovaný): `notificationId, userId, type, status, timestamp, provider, errorCode`. Bez obsahu správy a kontaktov, audit osobné údaje nepotrebuje.
- **Úložisko podľa záťaže:**
  - 100k/s: **PostgreSQL** s partíciami podľa dňa, dávkové INSERT/COPY. Staré partície sa presúvajú do archívu.
  - 1M/s: **sharded MongoDB**, alebo dávky do **S3 (Parquet)** a dotazy cez **Athena**.
  - Posledné dni môže držať priamo stream s dlhšou retenciou. Je to trvalý log, ktorý sa dá prehrať znova.
- **Výpadok auditu:** správy čakajú v streame a doplnia sa neskôr. Doručovanie beží ďalej, nič sa nestratí.

## Krok 6 – spoľahlivosť

- **Retry s exponenciálnym backoffom** (opakovanie s rastúcim čakaním) a **dead-letter queue** pre správy, ktoré opakovane zlyhávajú.
- **Idempotencia** (opakované spracovanie nespôsobí duplikát): kontrola `notificationId` pred odoslaním, aby pri at-least-once nešla SMS dvakrát.
- **Rate limit a circuit breaker** pre každú bránu (Resilience4j). Circuit breaker pri výpadku brány dočasne prestane posielať. Broker zatiaľ funguje ako zásobník.
- **Viac providerov** pre jeden kanál (SMS A / B), s prepnutím pri výpadku.
- **Ochrana API:** rate limit na klienta, validácia vstupu, JWT cez Spring Security.

## Krok 7 – prevádzka

- **Metriky:** prijaté/s, odoslané/s podľa kanála, lag, chybovosť brán. InfluxDB alebo CloudWatch + Grafana.
- **Trasovanie** jednej notifikácie naprieč službami cez `notificationId`, rovnaké ID je aj v audite.
- **Ďalšie rozšírenia** (nie v prvej verzii): preferencie používateľa (opt-out, tiché hodiny), šablóny správ.

## Výsledný obrázok

```
 Client ─► LB ─► User API ─► PostgreSQL ── user events ──► cache kontaktov (Hazelcast)
           │                                                      │
           └──► Notification API ─► Stream (partície podľa userId) ┼─► SMS workers   ─► SMS GW A/B
                 (N inštancií, 202)                                ├─► Email workers ─► EMAIL GW
                                                                   ├─► Push workers  ─► PUSH GW
                                                                   └─► Audit consumer ◄─ status events
                                                                          └─► Postgres partície / MongoDB / S3
```
