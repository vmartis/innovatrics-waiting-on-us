# Innovatrics – 2. kolo (návrh systému)

Tento priečinok zhŕňa druhé kolo pohovoru: **návrh notifikačného systému** (system design). Je tu zadanie, moje riešenie z pohovoru, dva vzorové návrhy (RabbitMQ a Kafka) a review môjho riešenia oproti nim.

---

## 1. Zadanie

**Kde je:** [`zadanie.drawio`](zadanie.drawio) (pôvodne `Notificatoin zadanie2.drawio`).

Navrhnúť systém s dvoma vstupmi:

1. **CRUD operácie nad používateľom:** `CRUD /user` (vytvorenie, čítanie, úprava, zmazanie).
2. **Odoslanie notifikácie:** `POST /notification` s telom `{ userId, type }`.
   - Typ notifikácie: **SMS**, **EMAIL** alebo **PUSH**.
   - Systém ju doručí cez príslušnú externú bránu (SMS / EMAIL / PUSH gateway).
   - Kontakt (telefón, email, device token) sa berie z údajov používateľa.

**Priepustnosť:** v diagrame **1 000 000 / 10 s = 100 000 notifikácií za sekundu**. Ústne zaznelo aj 10 000 000 / 10 s = 1 000 000/s, návrhy preto počítajú s oboma.

**Doplnená požiadavka počas pohovoru:** **audit**, teda každá notifikácia musí byť zaznamenaná v audit logu.

**Technológie:** podľa môjho CV (Java/Kotlin, Spring Boot, RabbitMQ, PostgreSQL, MongoDB, InfluxDB, Hazelcast, AWS, Docker/Helm). Kafka v CV nie je, preto je ako samostatný variant.

---

## 2. Obsah priečinka

| Súbor | Čo obsahuje |
|---|---|
| [`README.md`](README.md) | tento prehľad |
| [`zadanie.drawio`](zadanie.drawio) | pôvodné zadanie: vstupy, priepustnosť, tri brány |
| [`inovatrics-navrh-vysledok.drawio`](inovatrics-navrh-vysledok.drawio) | **moje riešenie z pohovoru** (receiver → Kafka + prio topic → sendery pre každý kanál, user/type cache, audit topic) |
| [`inovatrics-navrh-vysledok-review.md`](inovatrics-navrh-vysledok-review.md) | **review môjho riešenia:** čo je dobre, čo chýba (zoradené podľa dôležitosti), súhrnná tabuľka, čo povedať na pohovore navyše |
| [`notification-navrh-claude.md`](notification-navrh-claude.md) | vzorový návrh **s RabbitMQ**, postupne v krokoch 0–7 |
| [`notification-navrh-claude.drawio`](notification-navrh-claude.drawio) | diagram k RabbitMQ návrhu, 3 strany |
| [`notification-navrh-kafka.md`](notification-navrh-kafka.md) | ten istý návrh **s Kafkou**: rozdiely, vysvetlenie partícií, porovnanie RabbitMQ vs. Kafka |
| [`notification-navrh-kafka.drawio`](notification-navrh-kafka.drawio) | diagram ku Kafka návrhu, 3 strany |

### Strany v diagramoch

Oba vzorové diagramy majú 3 strany (záložky dole v draw.io):

1. **Naivná verzia:** synchrónne volanie brán. Prečo nestačí.
2. **Async + cache:** broker, kanály oddelené, kópia používateľov u workerov (RabbitMQ + Hazelcast, resp. Kafka + compacted topic `users`).
3. **Finálny návrh:** partície, retry/DLQ, rate limit, audit, monitoring, výpočet záťaže.

---

## 3. Odporúčané poradie čítania

1. **Zadanie:** [`zadanie.drawio`](zadanie.drawio), 1 minúta.
2. **Moje riešenie:** [`inovatrics-navrh-vysledok.drawio`](inovatrics-navrh-vysledok.drawio).
3. **Review:** [`inovatrics-navrh-vysledok-review.md`](inovatrics-navrh-vysledok-review.md). Najdôležitejší súbor na prípravu.
4. **Vzorový návrh krok za krokom:** [`notification-navrh-claude.md`](notification-navrh-claude.md) spolu s diagramom.
5. **Kafka variant:** [`notification-navrh-kafka.md`](notification-navrh-kafka.md), hlavne časti „Partície podľa userId“ a „RabbitMQ vs. Kafka“.

---

## 4. Hlavné poznatky v skratke

**Čo bolo v mojom riešení dobre:** asynchrónny príjem cez Kafku, samostatný sender pre každý kanál, cache používateľov, audit cez vlastný topic a **prioritný topic** (nápad navyše oproti vzorovým návrhom).

**Čo chýbalo (podrobne v review):**
1. **Audit nezachytí všetky notifikácie:** zapisujú doň len sendery. Má byť samostatná consumer group na hlavnom topicu (`RECEIVED`) + stavové udalosti `SENT` / `FAILED` / `DELIVERED`.
2. **Cache sa neaktualizuje pri zmene používateľa:** user service má publikovať udalosti o zmenách (compacted topic / outbox).
3. **Topicy, partície, potvrdenie zápisu:** topic pre každý kanál, `key = userId`, `acks=all`, receiver vo viacerých inštanciách za load balancerom.
4. **Spoľahlivosť:** retry s backoffom, dead-letter, rate limit a circuit breaker pre brány, idempotencia.
5. **Popisy databáz a čísla:** 100 000/s × ~500 B ≈ 50 MB/s ≈ 4 TB/deň → voľba úložiska auditu.

**Častá otázka:** „Partície podľa hashu userId“ neznamená partíciu pre každého používateľa. Počet partícií je pevný (napr. 60), `partícia = hash(userId) % 60`. Vysvetlené v [`notification-navrh-kafka.md`](notification-navrh-kafka.md).

---

## 5. Ako otvoriť diagramy

Súbory `.drawio` sa otvoria v [app.diagrams.net](https://app.diagrams.net) (*File → Open from → Device*), v desktopovej aplikácii draw.io alebo v IntelliJ / VS Code s pluginom Draw.io Integration.
