# Návrh notifikačného systému – variant s Kafkou

Diagram: `notification-navrh-kafka.drawio` (3 strany: naivná verzia, Kafka + compacted users, finálny návrh s auditom).
Variant s RabbitMQ je v `notification-navrh-claude.md`. Kroky 0, 1, 6 a 7 sú rovnaké, tu sú popísané hlavne rozdiely.

**Riešenie v jednej vete:** API zapíše notifikáciu do Kafka topicu podľa kanála a vráti `202 Accepted`. Workery každého kanála sú jedna consumer group. Audit je ďalšia, nezávislá consumer group, ktorá zapisuje do úložiska cez Kafka Connect.

> Poznámka k CV: Kafka v CV nie je, RabbitMQ áno. Na pohovore by som to povedal otvorene: „Pri 1M/s by som volil Kafku. Princípy poznám, produkčné skúsenosti mám s RabbitMQ.“

---

## Základné pojmy (pre istotu)

- **Topic:** pomenovaný log správ. Správy sa len pripisujú na koniec, po prečítaní sa nemažú, zostávajú tam počas retencie.
- **Partícia:** časť topicu. V rámci partície je zachované poradie. Partície sa dajú spracovávať paralelne.
- **Key:** podľa kľúča (tu `userId`) sa určí partícia. Správy jedného používateľa idú vždy do tej istej partície, teda v poradí.
- **Consumer group:** skupina inštancií, ktoré si partície rozdelia. Každá group má vlastný **offset** (kde skončila), takže viac groups číta ten istý topic nezávisle.
- **RF (replication factor):** koľko brokerov drží kópiu partície. Štandardne 3.

## Krok 1 – naivná verzia

Rovnaká ako vo variante s RabbitMQ: synchrónne volanie brán a SELECT pre každú správu. Nestačí.

## Krok 2 – Kafka namiesto RabbitMQ (strana 2)

```
Client ─POST─► Notification API ─produce─► notifications.sms   ─► consumer group sms   ─► SMS gateway
   ◄── 202                     (key=userId) notifications.email ─► consumer group email ─► EMAIL gateway
                                            notifications.push  ─► consumer group push  ─► PUSH gateway
```

- **Topic pre každý kanál** namiesto exchange s routovaním. API pri publikovaní vyberie topic podľa `type`. Kanály sú izolované: pomalé SMS nebrzdia push.
- **Spoľahlivý zápis:** producer s `acks=all`, `enable.idempotence=true`, `min.insync.replicas=2`. 202 ide až keď správu uložia aspoň 2 brokery. Idempotentný producer nezapíše pri opakovanom pokuse duplikát.
- **Škálovanie:** počet aktívnych workerov v group je najviac počet partícií. Partície treba naplánovať dopredu, pridať sa dajú, ale nedajú sa odobrať.

### Partície podľa userId – neznamená to partíciu pre každého používateľa

Počet partícií je **pevný a malý** (napr. 60). Každý `userId` sa do jednej z nich len namapuje:

```
partícia = hash(userId) % počet_partícií
```

| userId | hash % 60 | partícia |
|---|---|---|
| 123 | 17 | 17 |
| 456 | 3 | 3 |
| 789 | 17 | 17 |
| … ďalších 10 miliónov | 0–59 | 0–59 |

- Pri 1 000 aj pri 100 miliónoch používateľov je **partícií stále 60**. Na jednu partíciu len pripadne viac používateľov.
- Hash ich rozloží **rovnomerne**. Kafka to robí sama, keď správe nastavíš `key = userId` (algoritmus murmur2). Nič sa nepočíta ručne.
- Počet partícií sa volí podľa **priepustnosti a počtu workerov**, nie podľa počtu používateľov. 60 partícií = najviac 60 paralelných workerov na kanál.

**Prečo kľúč podľa userId:**
- **Poradie:** správy jedného používateľa sú v jednej partícii, prídu v poradí, v akom boli poslané.
- **Lokálnosť:** ten istý worker vidí všetky správy používateľa. Hodí sa napr. na limit „max 5 SMS za hodinu na používateľa“.
- Ak poradie ani limit netreba, kľúč nemusí byť vôbec. Kafka potom rozdeľuje sama (sticky partitioner), rovnomernejšie a o niečo rýchlejšie.

**Na čo si dať pozor:**
- **Horúci kľúč (hot key):** jeden používateľ s extrémne veľa správami preťaží svoju partíciu. Pri notifikáciách je to malé riziko.
- **Pridanie partícií neskôr** zmení výsledok `% N`. Časť používateľov sa presunie do inej partície a na chvíľu sa poruší poradie. Preto sa partície dávajú s rezervou hneď na začiatku.

## Krok 3 – používatelia cez compacted topic

```
User API ─► PostgreSQL (zdroj pravdy)
   └─► topic "users" (cleanup.policy=compact, key=userId) ─► GlobalKTable / RocksDB v každom workeri
```

- **Compacted topic** drží pre každý kľúč len **poslednú verziu**. Zmazanie používateľa je správa s prázdnou hodnotou (*tombstone*).
- Worker si pri štarte prečíta celý topic a má úplnú lokálnu kópiu kontaktov. Potom už len dočítava zmeny. Nepotrebuje Hazelcast ani dotazy do DB.
- **Kafka Streams GlobalKTable** to robí automaticky, dáta drží lokálne v RocksDB.
- Pre spoľahlivé publikovanie zmien z User API: **transactional outbox** (udalosť sa zapíše do tabuľky v tej istej DB transakcii, potom sa odošle do Kafky), prípadne **Debezium** (CDC, číta zmeny priamo z PostgreSQL WAL logu). Zápis do DB a do Kafky sa tak nerozíde.

## Krok 4 – priepustnosť (strana 3)

| Záťaž | Správ/s | Dáta | Za deň | Na diskoch (RF=3) |
|---|---|---|---|---|
| 1M / 10 s | 100 000 | ~50 MB/s | ~4 TB | ~13 TB |
| 10M / 10 s | 1 000 000 | ~500 MB/s | ~43 TB | ~130 TB |

- Kafka zvláda **1M správ/s** bežne, na pár brokeroch. Je to sekvenčný zápis na disk.
- **Producer:** dávkovanie (`batch.size`, `linger.ms` napr. 5 ms) a kompresia (`lz4`). Veľký rozdiel v priepustnosti.
- **Partície:** napr. 60–120 na topic. Úzke hrdlo nie je Kafka, ale volania brán. Workery volajú brány asynchrónne (neblokujúci HTTP klient), inak treba veľmi veľa inštancií.
- **Retencia** podľa diskov, napr. 1–7 dní.
- **Na AWS:** Amazon **MSK** (spravovaná Kafka), workery na EKS s autoscalingom podľa **consumer lagu** (KEDA).

## Krok 5 – audit

```
notifications.* ──► consumer group "audit" (Kafka Connect) ──► Postgres partície / S3
workers ──► notification-status (SENT / FAILED / DELIVERED) ──┘
```

- **Audit je ďalšia consumer group** na tých istých topicoch. Má vlastný offset, takže workery vôbec nespomaľuje. Toto je pri Kafke najväčšia výhoda: fan-out je zadarmo, netreba kopírovať správy do ďalšej fronty.
- **Stavové udalosti:** workery zapisujú `SENT` / `FAILED` do topicu `notification-status`. `DELIVERED` príde cez callback brány.
- **Kafka Connect** (hotový framework na prenos dát z/do Kafky, netreba písať vlastný consumer):
  - **JDBC sink** do PostgreSQL s partíciami podľa dňa, pre 100k/s;
  - **S3 sink** do Parquet súborov + dotazy cez Athena, pre 1M/s alebo dlhodobý archív.
- **Hot audit:** samotný topic s retenciou je trvalý, prehrávateľný log. Keď sink vypadne, dočíta od posledného offsetu. Nič sa nestratí.
- Záznam: `notificationId, userId, type, status, timestamp, provider, errorCode`. Bez obsahu správy a kontaktov.

## Krok 6 – spoľahlivosť (rozdiely oproti RabbitMQ)

- **Retry topicy** namiesto requeue: `*.retry-1m`, `*.retry-10m`, `*.dlt` (dead-letter topic). Spring Kafka to vie cez `@RetryableTopic`. Neúspešná správa neblokuje partíciu, presunie sa do retry topicu.
- **Doručenie:** at-least-once (offset sa commitne až po odoslaní) + idempotencia cez `notificationId`. Exactly-once v Kafke platí len v rámci Kafky, nie pre externú SMS bránu.
- Rate limit, circuit breaker (Resilience4j) a viac providerov zostávajú rovnaké.

## Krok 7 – prevádzka

- Kľúčová metrika je **consumer lag** pre každú group: koľko správ ešte čaká. Podľa neho sa škáluje aj alertuje.
- Ďalej throughput, chybovosť brán, stav brokerov (under-replicated partitions).

---

## RabbitMQ vs. Kafka – kedy čo

| | RabbitMQ (klasické fronty) | Kafka |
|---|---|---|
| Priepustnosť | desiatky tisíc/s na uzol | milióny/s na cluster |
| Po prečítaní | správa zmizne | zostáva počas retencie |
| Fan-out (audit) | ďalšia fronta = kópia správy | ďalšia consumer group, zadarmo |
| Prehranie histórie | nie (Streams áno) | áno, posun offsetu |
| Routovanie | bohaté (exchange, routing keys) | jednoduché (topic + key) |
| Retry / DLQ | vstavané (DLX, TTL) | retry topicy (`@RetryableTopic`) |
| Prevádzka | jednoduchšia | náročnejšia (MSK pomôže) |
| Skúsenosť z CV | áno | nie |

**Odporúčanie:** pri 100k/s ide obe, RabbitMQ (ideálne Streams) je OK a poznáš ho. Pri 1M/s a s auditom, ktorý chce čítať každú správu, je Kafka prirodzenejšia voľba.

## Výsledný obrázok

```
 Client ─► LB ─► User API ─► PostgreSQL ─► (outbox / Debezium) ─► topic users (compact) ─► GlobalKTable vo workeroch
           │
           └──► Notification API ─► notifications.sms   ─► SMS workers   ─► SMS GW A/B
                 (acks=all, 202)    notifications.email ─► Email workers ─► EMAIL GW
                                    notifications.push  ─► Push workers  ─► PUSH GW
                                          │                    │ SENT/FAILED/DELIVERED
                                          │                    ▼
                                          └──► Kafka Connect (group audit) ◄─ notification-status
                                                     └─► Postgres partície / S3 + Athena
```
