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

### Ako funguje consumer group (koľko workerov na partíciu)

**V jednej group číta každú partíciu v danom momente práve jeden worker, ale jeden worker môže čítať viac partícií.** „Jeden worker na partíciu“ vyjde iba vtedy, keď je workerov rovnako ako partícií.

| Workerov v group `sms` (60 partícií) | Čo dostane každý worker |
|---|---|
| 1 | všetkých 60 partícií |
| 10 | po 6 partícií |
| 60 | po 1 partícii (najväčší možný paralelizmus) |
| 80 | 60 pracuje, **20 stojí** (len záloha) |

```
notifications.sms (60 partícií)
  P0–P5   ─► sms worker 1
  P6–P11  ─► sms worker 2
  ...
  P54–P59 ─► sms worker 10

Tie isté partície číta znova a samostatne:
  P0–P59  ─► group "audit" (vlastné workery, vlastný offset)
```

- **Pravidlo:** v jednej group nikdy nečítajú dva workery tú istú partíciu. Preto idú správy jedného používateľa v poradí.
- **Rôzne groups sa neovplyvňujú.** Každá má vlastný **offset** pre každú partíciu („spracoval som po správu 1 234“). Audit preto sendery nespomaľuje.

**Rebalance – keď worker pribudne alebo odíde:**
- Jeden broker je **group coordinator**. Workery mu posielajú heartbeat („žijem“).
- Keď worker pribudne (autoscaling), odíde (deploy) alebo spadne, coordinator rozdelí partície nanovo.
- Nový worker pokračuje od posledného uloženého offsetu. Ak starý SMS poslal, ale spadol pred uložením offsetu, pošle sa znova → **at-least-once**, sender musí duplicity preskočiť podľa `notificationId`.
- **Cooperative sticky assignor** presunie iba partície, ktoré treba. Ostatné workery bežia ďalej.

**Worker vs. consumer:**
- Worker = jedna inštancia (pod). V Spring Kafka dá `concurrency = 3` tri consumery na pod, každý je samostatný člen group.
- Limit: **všetci consumeri v group spolu ≤ počet partícií**. Pri 60 partíciách a `concurrency = 3` má zmysel najviac 20 podov.

**Keď ani jeden worker na partíciu nestačí:** brána odpovedá 100+ ms, posielať po jednej je pomalé. Worker môže posielať veľa požiadaviek naraz (neblokujúci HTTP klient), musí však držať poradie pre každého používateľa a offset uložiť až keď je hotové všetko pred ním. Presne toto robí **Confluent Parallel Consumer**.

**Na pohovor:** „Každý kanál má vlastnú consumer group. Kafka dá každú partíciu práve jednému workeru v group, takže správy jedného používateľa idú v poradí. Workery škálujeme podľa consumer lagu, najviac do počtu partícií. Audit je samostatná group s vlastnými offsetmi.“

## Krok 3 – používatelia cez compacted topic

```
User API ─► PostgreSQL (zdroj pravdy)
   └─► topic "users" (cleanup.policy=compact, key=userId) ─► GlobalKTable / RocksDB v každom workeri
```

**V skratke:** každý worker má na vlastnom disku úplnú kópiu kontaktov všetkých používateľov a Kafka ju udržiava aktuálnu. Kontakt nájde bez volania DB.

**Problém:** správa nesie iba `userId`, worker potrebuje telefón / email / push token. Pri 1M správ/s by to bol 1M SELECTov za sekundu do PostgreSQL. Worker sa preto pýta iba vlastnej kópie.

### Compacted topic `users` – odkiaľ dáta prichádzajú

- Pri každej zmene používateľa ide do topicu správa s jeho aktuálnymi údajmi.
- **Bežný topic** maže podľa času (napr. po 7 dňoch). Používateľ spred roka by zmizol, preto to nejde.
- **Compacted topic** (`cleanup.policy=compact`) drží pre každý kľúč len **poslednú verziu**:

| Pred kompakciou | Po kompakcii |
|---|---|
| 123 → tel. 0901 111 111 | |
| 456 → tel. 0902 222 222 | 456 → tel. 0902 222 222 |
| 123 → tel. 0905 999 999 | 123 → tel. 0905 999 999 |
| 789 → null (zmazaný) | *(časom zmizne celý)* |

- Topic je teda **tabuľka uložená ako log**: jeden riadok na používateľa, nikdy nevyprší.
- **Zmazanie** je správa s prázdnou hodnotou (*tombstone*). Kafka ju po čase (`delete.retention.ms`) odstráni tiež. Dobré pre GDPR.
- Veľkosť: 10M používateľov × ~500 B ≈ 5 GB. Pre Kafku malé.
- Pre spoľahlivé publikovanie zmien z User API: **transactional outbox** (udalosť sa zapíše do tabuľky v tej istej DB transakcii, potom sa odošle do Kafky), prípadne **Debezium** (CDC, číta zmeny priamo z PostgreSQL WAL logu). Zápis do DB a do Kafky sa tak nerozíde.

### GlobalKTable – ako sa topic dostane do workera

- **KTable** (knižnica Kafka Streams) je pohľad na topic ako na tabuľku „kľúč → posledná hodnota“.
- **Global** = každý worker dostane **všetky** partície topicu `users`, opak consumer group. Každý worker musí poznať každého používateľa.
- **Pri štarte** prečíta topic od začiatku a naplní lokálnu tabuľku. Kým nie je hotový, notifikácie nespracúva. **Potom** už len priebežne dočítava zmeny.

### RocksDB – kde kópia leží

- Malá key-value databáza, ktorá beží **vnútri procesu workera** ako knižnica. Nie je to server, žiadne sieťové volanie.
- Dáta sú na lokálnom disku, najčastejšie použité v pamäti. 5 GB nemusí byť celých v RAM.
- Vyhľadanie v mikrosekundách (Hazelcast / DB cez sieť: milisekundy). Kafka Streams si RocksDB vytvorí a plní sama.

### Ako to beží

```
Notifikácia:   notifications.sms {userId: 123} ─► worker: store.get(123) ─► 0905 999 999 ─► SMS brána
Zmena čísla:   User API ─► DB ─► topic users {123 → 0905 999 999} ─► všetky workery prepíšu RocksDB
```

- Zmena dorazí ku všetkým workerom zvyčajne do sekundy. **Eventual consistency:** krátke okno, keď sa môže použiť staré číslo. Pri notifikáciách prijateľné.
- **Reštart:** s trvalým diskom (persistent volume) RocksDB zostane a worker dočíta len zmeny od checkpointu. Bez neho číta celý topic znova (pri 5 GB minúty). Preto workery dostanú trvalý disk.

### Na čo si dať pozor

- **Prečo nie Hazelcast?** Žiadny ďalší cluster, žiadne sieťové volanie. Kafka je zdroj aj distribúcia zmien.
- **Pamäť:** každý worker drží všetko. Pri 10M OK. Pri miliardách bežná **KTable**: `users` aj notifikácie s kľúčom `userId` a rovnakým počtom partícií (co-partitioning), každý worker drží len svojich používateľov.
- **Externé volania z Kafka Streams** sú netypické. Čistejšie v dvoch krokoch: Streams aplikácia správu len **obohatí** o kontakt → `notifications.sms.enriched` → obyčajný Spring Kafka sender ju pošle.
- **Alternatíva bez cache:** API doplní kontakt do správy už pri prijatí. Workery kontakty nepotrebujú, ale API musí čítať používateľa.

**Na pohovor:** „Kontakty publikujem cez outbox do compacted topicu `users`, jedna aktuálna verzia na používateľa. Každý worker ho číta ako GlobalKTable a drží lokálnu kópiu v RocksDB. Vyhľadanie je lokálne v mikrosekundách, bez dotazov do DB, a zmeny sa šíria do sekundy.“

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

**V skratke:** audit je samostatný odberateľ, ktorý z Kafky zbiera všetky udalosti každej notifikácie (prijatá, odoslaná, zlyhala, doručená) a ukladá ich do úložiska. Sendery vôbec nespomaľuje.

**Na čo slúži:**
- **Podpora:** „Prišla používateľovi 123 včera OTP SMS?“
- **Compliance a spory:** dôkaz, že notifikácia odišla, kedy a cez ktorú bránu.
- **Štatistiky a fakturácia:** koľko SMS odišlo cez bránu A, koľko zlyhalo.

Požiadavky: nespomaliť odosielanie, nič nestratiť, zachytiť aj notifikáciu, pri ktorej sender zlyhal, neukladať citlivý obsah.

```
                   ┌──────────────► sms worker ──► SMS brána ──callback──► Callback API
Notification API ─►│ notifications.*      │                                    │
  (RECEIVED)       │                      │ SENT / FAILED / EXPIRED            │ DELIVERED
                   │                      ▼                                    ▼
                   │              notification-status ◄────────────────────────┘
                   │                      │
                   └──────────┬───────────┘
                              ▼
                 Kafka Connect (consumer group "audit")
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
        PostgreSQL (hot, 7–30 dní)     S3 Parquet + Athena (roky)
```

### Odkiaľ prichádzajú udalosti

**1. `RECEIVED` – priamo z hlavných topicov**
- Audit číta `notifications.sms/email/push` ako **vlastná consumer group** s vlastným offsetom, workery nespomaľuje. Pri Kafke najväčšia výhoda: fan-out je zadarmo, netreba kopírovať správy do ďalšej fronty.
- **Prečo nie zápis do DB priamo z API:** API by čakalo na DB a vznikol by *dual write* – zápis do Kafky prejde, do DB nie (alebo naopak), záznamy sa rozídu.
- **Prečo nie zápis zo senderov:** keď sender spadne alebo správu nikdy nespracuje, audit o nej nevie. Presne táto medzera bola v mojom riešení z pohovoru.

**2. `SENT` / `FAILED` / `EXPIRED` – od workerov**
- Po pokuse o odoslanie worker zapíše malú udalosť do topicu `notification-status`, kľúč `userId` – všetky stavy jednej notifikácie sú v jednej partícii, v poradí.
- Napr. `{notificationId, userId, type, status: SENT, provider: "gw-A", providerMessageId, errorCode, timestamp}`.

**3. `DELIVERED` – callback od brány**
- SMS brána neskôr pošle **delivery report** (SMS prišla do telefónu) cez webhook na malú službu Callback API. Pri emaile z SES cez SNS.
- Callback API to zapíše do `notification-status` ako `DELIVERED`.
- Brána pozná len svoje ID, preto pri odoslaní posielame `notificationId` ako `clientReference` a brána ho v callbacku vráti. Inak treba uložiť mapovanie `providerMessageId → notificationId`.
- Push (FCM/APNs) skutočné doručenie zvyčajne nepotvrdzuje, tam končíme na `SENT`.

### Kafka Connect – kto to zapisuje

- Hotový framework na presun dát medzi Kafkou a inými systémami. Samostatný cluster workerov, konektory sa len nakonfigurujú (JSON cez REST), **žiadny vlastný kód**.
- **Sink konektor** je v skutočnosti consumer group: číta topicy, zbiera dávky, zapisuje naraz.
- **Citlivé polia preč:** `notifications.*` obsahuje text správy. SMT (*single message transform*) `ReplaceField` vyhodí `text` a kontakty pred zápisom. Záznam: `notificationId, userId, type, status, timestamp, provider, errorCode`.
- **Chybné správy:** `errors.tolerance=all` + vlastný DLQ topic konektora. Jedna poškodená správa nezastaví audit.

### Kam sa to ukladá

**PostgreSQL – hot audit pre podporu (7–30 dní)**

Tabuľka **iba na pridávanie** (append-only), riadok na udalosť:

```sql
CREATE TABLE notification_audit (
  notification_id uuid, user_id bigint, type text, status text,
  provider text, error_code text, ts timestamptz,
  PRIMARY KEY (notification_id, status, ts)
) PARTITION BY RANGE (ts);      -- jedna partícia na deň
```

- **Partície podľa dňa:** staré dáta preč cez `DROP` partície, okamžite, bez pomalého `DELETE`.
- **Udalosti, nie jeden riadok s posledným stavom:** insert je rýchlejší ako update, zostane história, nevadí poradie (`DELIVERED` môže prísť skôr ako `SENT`).
- Dotaz podpory (index na `(user_id, ts)`):

```sql
SELECT status, provider, error_code, ts FROM notification_audit
WHERE user_id = 123 AND ts > now() - interval '1 day' ORDER BY ts;
```

- **Limit:** 100k notifikácií/s ≈ 300k udalostí/s. Pre jeden PostgreSQL na hrane, potrebuje veľké dávky. Pri 1M/s nestačí.

**S3 + Athena – dlhodobý archív (roky), aj pri 1M/s**
- **S3 sink** píše **Parquet** (stĺpcový, dobre sa komprimuje) do priečinkov podľa času: `s3://audit/dt=2026-11-02/hour=10/…parquet`.
- **Athena** nad tým spúšťa SQL a číta len priečinky daného dňa.
- Lacné, bez limitu. Oneskorenie niekoľko minút (súbor sa zapíše po naplnení alebo po čase).
- S3 lifecycle: po roku do Glacieru, po N rokoch zmazať.

**Kombinácia:** PostgreSQL pre rýchle dotazy podpory, S3 pre všetko ostatné. Oba sinky čítajú tie isté topicy, každý ako vlastná group.

### Spoľahlivosť

- **Výpadok úložiska:** konektor stojí, rastie lag, dáta čakajú v Kafke. Po obnove pokračuje od posledného offsetu, sendery nič nepocítia. Retencia topicov musí byť dlhšia ako najdlhší očakávaný výpadok (napr. 3–7 dní).
- **Duplikáty:** Connect je tiež at-least-once. JDBC sink v režime `upsert` s primárnym kľúčom zapíše udalosť raz. S3 sink vie exactly-once – súbory pomenúva podľa offsetov, opakovaný zápis prepíše ten istý súbor.
- **Hot audit v Kafke:** `notification-status` s retenciou je trvalý, prehrateľný log. Audit sa dá prepočítať posunom offsetu späť.

### Na čo si dať pozor

- **Citlivé dáta:** nikdy text správy, telefón ani email. Len ID a stavy, uchovanie podľa pravidiel (GDPR).
- **„Visiaca“ notifikácia:** má `RECEIVED`, ale bez `SENT`/`FAILED` dlhšie ako napr. 15 minút. Dobrý alert, odhalí stratu alebo zaseknutý kanál.
- **Monitoring:** lag group `audit`, chyby a DLQ konektora.

**Na pohovor:** „Audit je samostatná consumer group na hlavných topicoch, takže `RECEIVED` zachytí každú notifikáciu, aj keď sender zlyhá. Workery posielajú `SENT`/`FAILED` do `notification-status`, `DELIVERED` príde z callbacku brány. Kafka Connect to bez vlastného kódu zapisuje do PostgreSQL rozdeleného po dňoch pre podporu a do S3 v Parquet na archív, cez SMT vyhodí obsah správy. Keď úložisko vypadne, dáta čakajú v Kafke a sendery to nepocítia.“

## Krok 6 – spoľahlivosť (rozdiely oproti RabbitMQ)

- **Retry topicy** namiesto requeue: `*.retry-1m`, `*.retry-10m`, `*.dlt` (dead-letter topic). Spring Kafka to vie cez `@RetryableTopic`. Neúspešná správa neblokuje partíciu, presunie sa do retry topicu.
- **Doručenie:** at-least-once (offset sa commitne až po odoslaní) + idempotencia cez `notificationId`. Exactly-once v Kafke platí len v rámci Kafky, nie pre externú SMS bránu.
- Rate limit, circuit breaker (Resilience4j) a viac providerov zostávajú rovnaké.

### Ako funguje retry topic

**V skratke:** neúspešná správa sa presunie do samostatného topicu, kde počká a skúsi sa znova. Hlavný topic medzitým beží ďalej.

**Problém:** v RabbitMQ sa neúspešná správa vráti do fronty (nack/requeue). V Kafke nie – partícia je log, worker ju číta v poradí. Opakovanie na mieste **zastaví celú partíciu** (*head-of-line blocking*). Pri 10M používateľoch a 60 partíciách by jedna zaseknutá SMS zdržala ~166 000 ľudí.

```
notifications.sms ─chyba─► sms-retry-1m ─chyba─► sms-retry-10m ─chyba─► sms-dlt
      │ ok                    │ po 1 min            │ po 10 min             └─► alert, ručný replay
      ▼                       ▼                     ▼
   SMS brána               SMS brána             SMS brána
```

1. Worker zlyhá → správu **skopíruje** do `sms-retry-1m`, uloží offset v hlavnom topicu a ide ďalej.
2. Retry consumer ju po 1 minúte skúsi znova. Pri ďalšej chybe ide do `sms-retry-10m`.
3. Po poslednom pokuse ide do **DLT** (*dead-letter topic*). Automaticky ho nikto nespracúva: alert a po oprave ručný replay späť.

- Do **hlavičiek** sa pridá pôvodný topic, partícia, offset, dôvod chyby a číslo pokusu. `notificationId` zostáva rovnaké, idempotencia platí aj pri opakovaní.

**Ako sa čaká, keď Kafka nevie „odložiť“ správu:**
- V hlavičke je čas, kedy sa má správa spracovať. Ak ešte nenastal, consumer **pozastaví partíciu** (`pause`), vráti sa na tú istú správu (`seek`) a po uplynutí času pokračuje (`resume`).
- **Jeden topic na každé oneskorenie:** všetky správy v `retry-1m` majú rovnaké oneskorenie, sú teda zoradené podľa času, kedy prídu na rad. Keď prvá ešte nie je na rade, nie je ani žiadna ďalšia.

**Spring Kafka to robí sám** (vytvorí topicy, hlavičky, pause/resume):

```kotlin
@RetryableTopic(
    attempts = "3",                                          // 1 + 2 opakovania
    backoff = Backoff(delay = 60_000, multiplier = 10.0),    // 1 min, 10 min
    exclude = [InvalidPhoneNumberException::class],          // trvalá chyba → rovno DLT
)
@KafkaListener(topics = ["notifications.sms"], groupId = "sms")
fun onSms(n: Notification) { ... }

@DltHandler
fun onDead(n: Notification) { /* stav FAILED do notification-status, alert */ }
```

**Ktoré chyby opakovať:**

| Chyba | Príklad | Čo s ňou |
|---|---|---|
| **dočasná** | timeout, HTTP 5xx, 429 | retry topic |
| **trvalá** | neplatné číslo, HTTP 400, nečitateľná správa | **rovno do DLT** |

Pred retry topicom býva **krátke opakovanie na mieste** (napr. 3× po 200 ms cez `DefaultErrorHandler`). Vyrieši väčšinu drobných výpadkov bez presúvania.

**Na čo si dať pozor:**
- **Poradie sa poruší:** správa z retry predbehne neskoršie správy toho istého používateľa. Pri notifikáciách zvyčajne nevadí.
- **Expirácia:** OTP platí 5 minút, poslať ho po 10 minútach nemá zmysel. Správa nesie `expiresAt`, po vypršaní sa neposiela, zapíše sa `EXPIRED`.
- **Výpadok celej brány nie je úloha pre retry topic.** Inak by sa 1M správ/s len presúvalo z topicu do topicu. Otvorí sa **circuit breaker**: worker prestane čítať hlavný topic (`pause`), správy bezpečne čakajú v Kafke, rastie lag, prípadne sa prepne na bránu B. Retry topicy sú na **jednotlivé** zlyhania.
- **Monitoring:** lag a počet správ v retry topicoch a v DLT. Rastúci DLT = alert.

**Na pohovor:** „V Kafke nemôžem správu vrátiť do fronty bez zablokovania partície. Preto neblokujúci retry: `retry-1m`, `retry-10m`, nakoniec DLT s alertom, cez `@RetryableTopic` v Spring Kafka. Trvalé chyby idú rovno do DLT a pri výpadku celej brány zastavím čítanie circuit breakerom, nie retry topicmi.“

### At-least-once a idempotencia

**V skratke:** at-least-once = žiadna notifikácia sa nestratí, ale môže prísť dvakrát. Idempotencia = druhé odoslanie sa zachytí a preskočí.

| Záruka | Čo znamená | Pre notifikácie |
|---|---|---|
| **at-most-once** | nikdy dvakrát, ale môže sa stratiť | zlé – stratená OTP SMS = používateľ sa neprihlási |
| **at-least-once** | nikdy sa nestratí, ale môže prísť dvakrát | **toto sa volí** |
| **exactly-once** | presne raz | s externou bránou sa nedá zaručiť |

**Prečo nejde exactly-once:** worker pošle SMS na bránu a uloží offset do Kafky. Tieto dve veci nie sú v jednej transakcii. Keď worker spadne medzi nimi, Kafka nevie, že SMS odišla. Kafka transakcie pokryjú len „čítam z Kafky → píšem do Kafky“.

**At-least-once v Kafke:**
- **API (producer):** `acks=all` – potvrdí sa až keď zápis majú repliky v ISR (pri `min.insync.replicas=2` aspoň 2 brokery), až potom `202`. `enable.idempotence=true` – broker rozpozná opakovaný zápis toho istého producera (producer id + poradové číslo). Rieši len opakovanie v rámci Kafky.
- **Worker (consumer):** `enable.auto.commit=false`, v Spring Kafka `AckMode.RECORD` alebo `MANUAL`. Poradie je kľúčové:
  - poslať → uložiť offset = at-least-once (pri páde sa pošle znova);
  - uložiť offset → poslať = at-most-once (pri páde sa stratí).

**Odkiaľ sa berú duplikáty:**
1. Klient nedostal `202` (timeout) a POST zopakuje.
2. Worker spadol po odoslaní, pred uložením offsetu – po rebalance ju pošle nový worker.
3. Rebalance: starý worker ešte dobieha, partíciu už má nový (zombie).
4. Timeout brány: SMS odišla, odpoveď nie – worker ju pošle do retry topicu.

**Implementácia idempotencie** (*idempotentné* = dvakrát spracované má rovnaký výsledok ako raz):

1. **Jednoznačné ID od začiatku.** API pridelí `notificationId` (UUID), nesie sa cez všetky opakovania a retry topicy. Klient posiela hlavičku `Idempotency-Key`: rovnaký kľúč druhýkrát → API vráti tú istú odpoveď a do Kafky nič nezapíše (kľúč v Redise s TTL). Rieši duplikát 1.
2. **Kontrola „už odoslané?“ vo workeri** – atomicky zapísať značku pred odoslaním, ak existuje, preskočiť:

| Kde | Ako | Poznámka |
|---|---|---|
| Redis | `SET sent:{id} SENDING NX EX 86400` | jednoduché, rýchle, rieši aj zombie |
| PostgreSQL | `INSERT … ON CONFLICT DO NOTHING` na unique `notification_id` | pri 1M/s priveľa zápisov |
| Lokálny RocksDB (Kafka Streams state store) | `store.putIfAbsent(id)` | bez siete; funguje, lebo `key = userId` posiela notifikáciu vždy do tej istej partície k tomu istému workeru; zálohované do changelog topicu |

   TTL značky dlhšie ako najdlhší retry (napr. 24 h).

3. **Kód workera (Spring Kafka, zjednodušene):**

```kotlin
@KafkaListener(topics = ["notifications.sms"], groupId = "sms", concurrency = "3")
fun onSms(n: Notification, ack: Acknowledgment) {
    val first = redis.opsForValue().setIfAbsent("sent:${n.id}", "SENDING", Duration.ofHours(24))
    if (first == false) { ack.acknowledge(); return }         // duplikát → preskočiť

    val phone = contacts.get(n.userId)                         // RocksDB / GlobalKTable
    smsGateway.send(phone, n.text, clientReference = n.id)     // ID ide aj bráne
    redis.opsForValue().set("sent:${n.id}", "SENT", Duration.ofHours(24))
    statusProducer.send("notification-status", n.userId, Status(n.id, SENT))
    ack.acknowledge()                                          // offset až na konci
}
```

   Pri jasnom odmietnutí bránou sa značka zmaže a správa ide do retry topicu (`@RetryableTopic`).

4. **Medzera, ktorá zostáva (povedať otvorene):** pád po odoslaní a pred zápisom `SENT` nechá značku `SENDING` – nevieme, či SMS odišla. Riešenie: `notificationId` poslať bráne ako jej idempotency key / client reference. Ak to brána nevie, zriedkavý duplikát sa akceptuje – dve OTP SMS sú menší problém ako žiadna.
5. **Idempotentní sú aj ďalší odberatelia:** audit a stavy robia upsert podľa `(notificationId, status)`.

**Na pohovor:** „Volím at-least-once: offset ukladám až po odoslaní, nič sa nestratí. Duplikáty riešim idempotenciou: `notificationId` od API plus `Idempotency-Key` od klienta, vo workeri atomické `SET NX` pred odoslaním a ID posielam aj bráne. Exactly-once s externou bránou zaručiť nejde, zvyšné okno pokryje len idempotencia na strane brány.“

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
