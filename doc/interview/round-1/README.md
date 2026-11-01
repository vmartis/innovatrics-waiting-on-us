# Innovatrics – Software Builder, 1. kolo (domáce zadanie)

Tento priečinok zhŕňa prvé kolo pohovoru: čo bolo zadanie, ako som ho vypracoval a čo z toho treba zlepšiť alebo vysvetliť v ďalšom kole.

| Súbor | Na čo slúži |
|---|---|
| [`README.md`](README.md) | tento prehľad |
| [`INTERVIEW_PREP.md`](INTERVIEW_PREP.md) | **review – čo zlepšiť:** výhrady od recenzenta, rozbor a riešenia, čo povedať na pohovore |

---

## 1. Zadanie

**Kde je:** [`README.md`](../../../README.md) v koreni projektu (originál v angličtine).

**V skratke:** človek, ktorý triedi požiadavky zákazníkov, hovorí:

> Požiadavky prichádzajú e-mailom, chatom a telefonicky. Dôležité kopírujem do tabuľky, ale tím sa ma stále pýta, čo treba zodpovedať, a zákazníkom sa niekedy ozvú dvaja z nás. Každý pondelok strávim hodinu zisťovaním, čo čaká na nás. Chcem, aby tím videl, čo treba riešiť, a aby za ďalší krok zodpovedal jeden človek. Nechcem ďalší systém na riadenie projektov, ktorý musia všetci udržiavať.

**Čo bolo k dispozícii:**
- Postgres databáza `app`, tabuľka `requests` so skutočnými prichádzajúcimi správami (README hovorí o 80, v skutočnosti ich bolo **340 od 22 zákazníkov**).
- Stĺpce: zákazník, kontakt, kanál (`email` / `chat` / `call`), čas prijatia, predmet, text, `in_reply_to` (na ktorú skoršiu správu nadväzuje).
- **Žiadny stĺpec pre stav, vlastníka ani prioritu** – tie som mal navrhnúť sám.
- Pripravený stroj s Claude Code, `./deploy.sh`, `start.sh`, `reset-data.sh`. Aplikácia na porte 3000.

**Časový limit:** 3 hodiny (15. 10. 2026, 13:39–16:39 UTC).

**Čo odovzdať:** živú URL, repozitár, jednostránkovú produktovú poznámku a jednostránkové záverečné zhrnutie.

---

## 2. Ako som ho vypracoval

### Postup

Pracoval som s Claude Code podľa pravidiel, ktoré som si na začiatku napísal do [`CLAUDE.md`](../../../CLAUDE.md):

1. **Produktová poznámka do 20 minút** – pre koho, čo robí, čo zámerne nerobí → [`PRODUCT_NOTE.md`](../../../PRODUCT_NOTE.md).
2. **Plán v tenkých vertikálnych rezoch** („slices“). Každý rez funguje od databázy po obrazovku, je otestovaný, nasadený a commitnutý → [`PLAN.md`](../../../PLAN.md).
3. **Najprv testy pre logiku**, potom kód. Na konci 124 testov.
4. **Hlavný workflow nasadený do 1:30.** Podarilo sa okolo 14:45 UTC, s rezervou.
5. **Každé rozhodnutie zapísané** s alternatívami a dôvodom → [`DECISIONS.md`](../../../DECISIONS.md).
6. **Vlastné skúšanie produktu** a zápis, čo bolo nepohodlné → [`FRICTION.md`](../../../FRICTION.md).
7. **Záverečné zhrnutie** → [`CLOSE_NOTE.md`](../../../CLOSE_NOTE.md).

Pomocníci v `.claude/`: agenti `reviewer`, `security-reviewer` a `user-tester` na kontrolu po každom reze a skilly `slice`, `status` a `wrap-up` na opakované kroky.

### Kľúčové rozhodnutia

- **Vlákno = jeden zákazník** – všetky jeho e-maily, chaty a hovory spolu. Jeden vlastník na zákazníka rieši „ozvú sa dvaja z nás“.
- **Stavy:** čaká → zabraté (s menom) → zodpovedané. Ak zákazník napíše po zodpovedaní, vlákno sa vráti medzi čakajúce.
- **Identita bez hesla** – kolega si vyberie meno zo zoznamu. Stačí na to, aby nikto neodpovedal dvakrát, ale nie je to dôkaz, kto čo urobil.
- **Ukážkové dáta sa nikdy nemenia** – stav je vo vlastnej tabuľke `thread_claims`.
- **Zámerne vynechané:** Jira a podobné nástroje (zadanie ich vylučuje), automatické skrývanie „nie-požiadaviek“, reporty a grafy.

### Čo vzniklo

- **Technológie:** React + TypeScript + Tailwind + shadcn/ui na fronte, Express + Postgres na serveri. Popis API je v [`API.md`](../../../API.md).
- **Hotové (rezy S1–S5):** zoznam čakajúcich vlákien, výber mena, zabratie vlákna (druhý kolega dostane odmietnutie), celá konverzácia naprieč kanálmi, označenie „answered“, vrátenie vlákna, zrušenie vlastného „answered“.
- **Navyše (N1–N5):** zabratie jedným klikom z riadku, počet čakajúcich v hlavičke, vyhľadávanie zákazníka, radenie od najdlhšieho čakania, filter „Only mine“.
- **Výsledok:** 124/124 testov, nasadené na živej URL, workflow overený na živých dátach.

### Výsledok kola

Postup do ďalšieho kola. Recenzent ocenil jasnú produktovú poznámku, jednoduchý a predvídateľný workflow, dobre ohraničené riešenie a úprimnú dokumentáciu.

---

## 3. Review – čo zlepšiť

Podrobne v [`INTERVIEW_PREP.md`](INTERVIEW_PREP.md). V skratke tri výhrady recenzenta:

1. **Zoskupovanie iba podľa zákazníka** – viac tém jedného zákazníka splynie a jedno „answered“ zavrie všetky. Návrh: zákazník ako skupina s jedným vlastníkom, vnútri témy podľa `in_reply_to`, „answered“ po témach.
2. **Urgencia pri opakovaných urgenciách** – zoznam radí podľa najnovšej správy, takže zákazník, ktorý urguje, klesne na koniec. Návrh: merať od najstaršej nezodpovedanej správy a zobraziť počet urgencií.
3. **Poznámky nesedia s kódom** – napr. pravidlo „čaká na nás“ v `PRODUCT_NOTE.md` je pôvodné, kód používa ručné „answered“. Poučenie: na konci porovnať poznámky s kódom.

**Ďalšie kolo:** utorok 3. 11. 2026, 14:30, Bratislava – prechod zadaním a systémový návrh.
