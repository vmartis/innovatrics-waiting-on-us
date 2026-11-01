# Review riešenia `inovatrics-navrh-vysledok.drawio`

Porovnanie s návrhmi `notification-navrh-claude.md` (RabbitMQ) a `notification-navrh-kafka.md` (Kafka).

**V skratke:** Kostra je správna a v podstate zhodná s Kafka variantom: asynchrónny príjem, Kafka, samostatný sender pre každý kanál, cache, audit topic. **Prioritný topic** je dokonca nápad navyše. Najväčšie medzery:
1. audit zaznamenáva len odoslané správy, nie všetky prijaté;
2. cache sa neaktualizuje pri zmene používateľa;
3. chýba retry, dead-letter a ochrana brán;
4. chýbajú čísla a popisy databáz.

---

## Ako diagram čítam

Niektoré prvky nemajú popis, takže toto je moja interpretácia. Ak niečo sedí inak, oprav ma.

```
CRUD /user ─────────► user service (2 inštancie) ─► DB (3 valce = cluster/repliky)
                              ▲
POST /notification ─► notification receiver ─────┘  (dotaz na usera, keď nie je v cache)
                      [type cache][user cache]
                              ├─► DB (malý valec hore, bez popisu)
                              ▼
                      Kafka  +  Kafka prio topic
                              ├─► notification sender ◄─► DB (bez popisu) ─► SMS gateway
                              ├─► notification sender ──────────────────────► EMAIL gateway
                              └─► notification sender ──────────────────────► PUSH gateway
                                        │ (všetky 3 sendery)
                                        ▼
                              Kafka audit topic ─► DB (audit, bez popisu)
```

Prerušované zvislé čiary chápem ako hranicu systému: vstupy vľavo, externé brány vpravo.

---

## Čo je dobre

| Prvok | Prečo je to dobre |
|---|---|
| Receiver → Kafka → sendery | Príjem je oddelený od pomalých brán. Rovnaký princíp ako v mojom návrhu. |
| Sender pre každý kanál | Izolácia: zaseknuté SMS nebrzdia email a push. |
| `user cache` v receiveri | Nerobí sa dotaz do DB pre každú notifikáciu. |
| `type cache` | Konfigurácia typov (šablóny, povolené kanály) sa necháva v pamäti. |
| **Kafka prio topic** | **Toto v mojom návrhu nie je.** Oddelenie urgentných správ (OTP kód, bezpečnostné upozornenie) od hromadných kampaní je veľmi praktické. Kampaň s 10M správ nesmie zdržať prihlasovaciu SMS. |
| Audit cez vlastný topic | Zápis do auditu nespomaľuje odosielanie. |
| User service vo viacerých inštanciách, DB ako cluster | Myslí sa na dostupnosť. |

---

## Čo chýba alebo by som urobil inak

Zoradené od najdôležitejšieho.

### 1. Audit nezachytí všetky notifikácie ⚠️

Do audit topicu zapisujú len **sendery**. Zadanie hovorí, že **každá** notifikácia musí byť v audite. Teraz sa do auditu nedostanú správy, ktoré:
- receiver prijal, ale sender ich ešte nespracoval (lag, výpadok, pád);
- skončili v chybe pred odoslaním (neznámy používateľ, chýba kontakt).

Ďalší problém je, že sender robí **dva zápisy** (*dual write*): odošle do brány a potom zapíše do audit topicu. Ak padne medzi nimi, záznam chýba.

**Ako to riešim ja:**
- Audit je **samostatná consumer group** na hlavnom notifikačnom topicu a zaznamená `RECEIVED` hneď pri prijatí.
- Sendery posielajú len **stavové udalosti** `SENT` / `FAILED`.
- `DELIVERED` príde cez **callback** brány. Ten vo tvojom návrhu tiež chýba.
- Zápis do auditu je idempotentný (`notificationId + status`), takže duplikát pri opakovaní nevadí.

### 2. Cache sa neaktualizuje pri CRUD ⚠️

Receiver si používateľa dotiahne z user service a uloží do `user cache`. Čo sa však stane, keď používateľ:
- **zmení telefón alebo email?** Pošle sa na starý kontakt.
- **sa zmaže?** Stále dostáva notifikácie, čo je problém aj z pohľadu GDPR.

Navyše pri prázdnej cache (po reštarte) príde 100 000 req/s priamo na user service a môže ho zložiť.

**Ako to riešim ja:**
- User service pri každej zmene publikuje udalosť (`UserCreated` / `Updated` / `Deleted`).
- V Kafka variante ide udalosť do **compacted topicu** `users`. Cache sa podľa neho aktualizuje okamžite a po reštarte sa naplní z topicu, nie z user service.
- Spoľahlivé publikovanie zabezpečí outbox tabuľka alebo Debezium.

### 3. Návrh topicov a partícií nie je jasný

- Z diagramu nie je jasné, či je **jeden topic pre všetky typy** (každý sender potom číta všetko a 2/3 zahodí), alebo **topic pre každý kanál**. Odporúčam topic pre každý kanál, s prioritou napríklad `sms.high`, `sms.normal`, `email.normal`, …
- Chýba **kľúč a počet partícií**: `key = userId`, napr. 60 partícií, podľa toho aj max. počet senderov.
- Chýba **potvrdenie zápisu**: receiver vráti `202` až po `acks=all`.

### 4. Škálovanie receivera a senderov

- `notification receiver` je nakreslený ako **jedna inštancia** a nie je pred ním **load balancer**. Pri 100 000 req/s treba N inštancií. User service je naopak nakreslený dvakrát, pri receiveri je to oveľa dôležitejšie.
- Pri senderoch zdôrazniť, že každý je **consumer group** s viacerými inštanciami a škáluje sa podľa **consumer lagu**.

### 5. Spoľahlivosť odosielania

Úplne chýba:
- **Retry s backoffom** (opakovanie s rastúcim čakaním) a **dead-letter topic** pre správy, ktoré opakovane zlyhajú.
- **Rate limit a circuit breaker** pre každú bránu. SMS provider nezvládne 100 000/s.
- **Záložný provider** (SMS A / B).
- **Idempotencia:** kontrola `notificationId`, aby pri opakovaní nešla SMS dvakrát.

### 6. Databázy bez popisu

V diagrame sú 4 databázy, žiadna nemá popis. Na pohovore treba pri každej povedať **čo v nej je a aká technológia**:

| DB | Moja domnienka | Otázka / riziko |
|---|---|---|
| Pri user service (cluster) | PostgreSQL, používatelia | OK, len popísať. |
| Pri receiveri (hore) | ? idempotencia / typy notifikácií | Synchrónny zápis pri 100k/s je úzke hrdlo. |
| Pri senderi (obojsmerná šípka) | ? stav odoslania / dedup | To isté. Ak je to stav, prečo je len pri jednom senderi? |
| Za audit topicom | audit | Akú technológiu zvládne 4 TB/deň? |

### 7. Chýbajú čísla

Ani hrubý odhad neuškodí, naopak, ukazuje, že si overuješ, či návrh zvládne požadovanú záťaž:
- 1 000 000 / 10 s = **100 000 správ/s**;
- pri ~500 B na správu je to ~50 MB/s, ~**4 TB/deň** (×3 pri replikácii v Kafke);
- z toho vyplýva voľba úložiska auditu: PostgreSQL partície podľa dňa + archív do S3, alebo S3 + Athena. K tomu **retencia** a čo sa stane so starými dátami.

### 8. Ostatné (menej dôležité, ale stojí za zmienku)

- **Monitoring:** consumer lag, throughput, chybovosť brán, alerting.
- **Bezpečnosť:** autentifikácia API (JWT), rate limit na klienta, v audite žiadne osobné údaje (bez obsahu správy a kontaktu).
- **Otázky na začiatku:** špička alebo trvalá záťaž, garancia doručenia, čo presne auditovať a ako dlho.
- **Kreslenie:** pri EMAIL a PUSH šípky z senderov nie sú pripojené k bránam a obsah topicu `Kafka` nemá popis. Na pohovore je to detail, ale pri čítaní diagramu mätie.

---

## Súhrnné porovnanie

| Oblasť | Tvoje riešenie | Môj návrh |
|---|---|---|
| Asynchrónny príjem cez Kafku | ✅ | ✅ |
| Izolácia kanálov | ✅ sender pre každý kanál | ✅ topic + consumer group pre každý kanál |
| Priorita správ | ✅ **prio topic** | ❌ (chýba, dobrý nápad) |
| Cache používateľov | ✅, ale bez invalidácie | ✅ udalosti / compacted topic |
| Audit všetkých prijatých správ | ❌ len od senderov | ✅ RECEIVED + SENT/FAILED/DELIVERED |
| Úložisko auditu | ⚠️ bez popisu | ✅ Postgres partície / S3 + Athena |
| Škálovanie API (LB, N inštancií) | ⚠️ 1 receiver | ✅ |
| Partície, kľúč, acks | ❌ | ✅ |
| Retry, DLQ, rate limit, circuit breaker | ❌ | ✅ |
| Idempotencia | ❌ | ✅ |
| Výpočet záťaže | ❌ | ✅ |
| Monitoring, bezpečnosť | ❌ | ✅ |

**Čo by som na pohovore povedal navyše za 2 minúty, s najväčším efektom:**
1. „Audit číta hlavný topic ako vlastná consumer group, takže zachytí každú prijatú správu, aj keď sender zlyhá.“
2. „User service publikuje zmeny do Kafky, cache sa tým aktualizuje a mazanie používateľa sa prejaví hneď.“
3. „Každá brána má rate limit, retry topic a dead-letter topic, aby výpadok providera nič nestratil.“
