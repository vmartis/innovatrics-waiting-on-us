# Príprava na pohovor – Innovatrics, Software Builder (verzia 2)

**Kedy:** utorok 3. 11. 2026, 14:30, Bratislava (Biometrics House), cca 2 hodiny.
**Program:** 1. prechod zadaním (rozhodnutia, kompromisy, čo by som spravil inak), 2. systémový návrh.

> **Čo je nové oproti verzii 1:** body 1 (varianta C) a 2 (riešenia 1 a 2) sú
> **naprogramované** v branchi `improvements_for_round_2`. Branch sa nemerguje do
> `main` – `main` ostáva odovzdané riešenie z kola 1. Pôvodná príprava je
> v `INTERVIEW_PREP.md`.

---

## 1. Čo im sa páčilo (môžem sa o to oprieť)

- `PRODUCT_NOTE.md` jasne popisuje používateľa a použitie – bolo vidieť, pre koho je nástroj.
- Hlavný workflow je jednoduchý, predvídateľný a zrozumiteľný.
- Riešenie je malé, dobre ohraničené a dodané ako fungujúci celok.
- Testy UI logiky a API sú primerané, dokumentácia úprimne popisuje, čo je hotové.

## 2. Čo chcú prebrať (podľa e-mailu)

1. Zoskupovanie správ iba podľa klienta – ťažko vidieť, ktoré témy sú vybavené a ktoré nie.
2. Priorita a urgencia v reálnych situáciách – napr. keď klient opakovane urguje.
3. Niektoré vety v `CLOSE_NOTE.md` a `PRODUCT_NOTE.md` nesedia s finálnym riešením.

„Nič z toho nie je dealbreaker“ – chcú o tom hovoriť.

**Moja stratégia:** pri bodoch 1 a 2 najprv vysvetlím pôvodné rozhodnutie a jeho cenu,
potom ukážem, ako som to po spätnej väzbe opravil – v branchi, nie v odovzdanom riešení.

---

## 3. Bod 1 – Zoskupovanie správ do vlákna

### Ako to bolo v kole 1

- **Vlákno = jeden zákazník.** Všetky jeho e-maily, chaty a hovory sú spolu (rozhodnutie v `DECISIONS.md`, 14:05).
- Jeden vlastník na zákazníka → rieši hlavnú bolesť zo zadania: „zákazníkom sa ozvú dvaja z nás“.
- Značka „answered“ platila pre **celého zákazníka**.

### Čo je stĺpec `in_reply_to` (fakty z dát)

- Obsahuje **`id` inej správy v tej istej tabuľke**, na ktorú správa nadväzuje.
- V tabuľke sú **iba správy od zákazníkov** → je to zákazník, ktorý pokračuje vo svojej skoršej správe.
- Vyplnený má **76 z 340 správ**, ostatných **264** nenadväzuje na nič.
- Odkaz vždy smeruje na správu **toho istého zákazníka**.
- Iba **24 zo 76** nadväzujúcich správ prišlo hneď po pôvodnej; medzi nimi môže byť až **9** iných správ.
- Priemerne vychádza **asi 10 tém na zákazníka** (napr. Kestrel Security 22 správ, 12 tém).

### Problém, ktorý vytkli

Ak má zákazník naraz dve témy (faktúra + výpadok), jedno „answered“ zavrie obe.

### Možnosti

| Varianta | Výhoda | Nevýhoda |
|---|---|---|
| **A. Iba podľa `in_reply_to`** | presné témy | ~264 položiek, žiadny vlastník zákazníka, „Any update?“ bez odkazu = nová téma |
| **B. Iba podľa zákazníka** (kolo 1) | prehľad, jeden vlastník | témy splynú, „answered“ zavrie všetko |
| **C. Kombinácia** (implementované) | prehľad aj presnosť | viac UI, dve nové tabuľky |

### Varianta C – ako je to teraz naprogramované

- **Zákazník zostáva jedným riadkom** v zozname a má **jedného vlastníka**. Ochrana proti dvojitej odpovedi zostáva.
- Vo vnútri sú správy rozdelené na **témy = reťaze `in_reply_to`**. Sú to presne tie isté bloky, ktoré detail vlákna kreslil už v kole 1.
- **„Answered“ sa ukladá po témach** (tabuľka `topic_answers`). Každá téma má tlačidlo „Mark topic answered“ a „Undo“.
- Zákazník zmizne zo zoznamu, až keď **nemá žiadnu otvorenú tému**. Hlásenie po poslednej téme: „That was the last open topic…“.
- „Mark all answered“ zostalo – zavrie všetky otvorené témy naraz (pri ~10 témach na zákazníka je to potrebné). „Undo“ vráti presne tie témy, ktoré tým zavrel.
- Téma sa **znova otvorí**, keď v nej zákazník napíše. Ako nezodpovedané sa rátajú iba nové správy.
- **Optimistická kontrola:** klient posiela id najnovšej správy témy, ktorú videl (`seenMessageId`). Ak medzitým prišla nová, server odmietne (409). Nemôžeš zavrieť správu, ktorú si nečítal.
- **Ručné presunutie:** správu **bez** `in_reply_to` („Any update?“) vie vlastník cez „Move to topic…“ presunúť do inej témy a aj vrátiť späť (tabuľka `message_topics`). Nikdy automaticky podľa textu – text je nedôveryhodný vstup.
- Správa, ktorá **má** `in_reply_to`, sa presunúť nedá – odkaz od zákazníka má prednosť pred naším odhadom.
- V zozname pri zákazníkovi: stĺpec **„Open topics“, napr. „7 of 8“**.
- Všetko ostáva v jednej transakcii so zamknutým riadkom claimu (`SELECT … FOR UPDATE`), takže claim, odovzdanie a zmena témy sa nepomiešajú.

### Chyba, ktorú som našiel pri preklikaní (dobrý príbeh na pohovor)

- Presunul som nezodpovedaný hovor („iOS SDK build fails“) do témy, ktorá už bola zodpovedaná.
- Téma ďalej ukazovala **„Answered“** – správa sa **potichu skryla**. Presne to, čomu má návrh zabrániť.
- **Oprava:** presunutá správa sa ráta ako nezodpovedaná, kým niekto tému nezodpovie **po** presune. Téma sa po presune otvorí s „1 unanswered“.
- Pokryté testom v `lib/topics.test.ts` aj `server/topics.test.ts`.
- **Poučenie:** unit testy prešli, chybu ukázalo až skutočné preklikanie v prehliadači – presne to, čo mi v kole 1 chýbalo.

### Ako to povedať

„Vlákno podľa zákazníka bolo vedomé rozhodnutie pre 3-hodinový limit – riešilo hlavnú bolesť, dvojité odpovede. Cena bola, že viac tém splynulo. Po vašej spätnej väzbe som to v samostatnej branchi dorobil: zákazník ostáva skupinou s jedným vlastníkom, vo vnútri sú témy podľa `in_reply_to` a ‚answered‘ sa ukladá po témach. Správy bez odkazu priraďuje človek, nie automat.“

### Čo ešte nie je (ak sa spýtajú)

- **Spájanie zákazníkov** z rôznych kanálov / kontaktov (návrh systému + potvrdenie človekom) – nerobené.
- Presunúť správu môže iba vlastník vlákna. Kto a kedy presunul, je uložené (`assigned_by`, `assigned_at`), ale história zmien nie je.

---

## 4. Bod 2 – Priorita a urgencia (opakované urgencie)

### Chyba v kole 1 – povedať ju sám ako prvý

- Zoznam sa radil podľa **najnovšej** správy a stĺpec „Waiting“ počítal čas tiež od nej.
- **Dôsledok:** zákazník čaká 5 dní, ráno napíše „Any update?“ → zrazu „2 hodiny“ a spadne na **koniec** zoznamu. Čím viac urguje, tým menej naliehavo vyzerá.

### Čo je teraz naprogramované (riešenia 1 a 2)

1. **Čakanie sa meria od najstaršej nezodpovedanej správy** (pole `waitingSince`, `lib/topics.ts`, `lib/waiting.ts`). Urgencia už zákazníka neodsunie dole. Pri prejdení myšou: „Oldest unanswered message: …“.
2. **Počet nezodpovedaných správ** – odznak **„9 unanswered“** v riadku (od 2 vyššie; jedna správa je normálny stav). V detaile pri téme „Open · 3 unanswered“.
   - Ovplyvňuje aj poradie: pri rovnako dlhom čakaní ide vyššie zákazník, ktorý urgoval viackrát.
- Vďaka témam je to presnejšie: čas a počet sa rátajú **iba z otvorených tém**. Keď zodpovieš tému s najstaršou správou, čakanie zákazníka sa skráti.

### Čo zatiaľ nie je (riešenia 3–6 ostávajú ako návrh)

3. Odznak **„nová správa, odkedy si to zobral“** pri zabratom vlákne aj vo filtri „Only mine“.
4. **Upozornenie, keď zabraté vlákno dlho stojí** – pre vedúceho alebo tím.
5. **SLA podľa zákazníka alebo kanála** (hovor = rýchlejšia reakcia).
6. Urgencia z obsahu („blocking“, „outage“) – len ako **návrh pre človeka**. Text je nedôveryhodný.

### Ako to povedať

„Pri príprave som si všimol, že zoznam radí podľa najnovšej správy – zákazník, ktorý urguje, tým paradoxne klesne dole. Opravil som to: čakanie sa meria od najstaršej nezodpovedanej správy a v riadku je vidno, koľko správ čaká bez odpovede.“

---

## 5. Bod 3 – Poznámky nesedia s riešením

*(Bez zmeny oproti verzii 1 – poznámky v `main` som zámerne neprepisoval.)*

| Kde | Čo tam stojí | Ako to je v skutočnosti |
|---|---|---|
| `PRODUCT_NOTE.md` | Vlákno „čaká na nás“, keď je najnovšia správa od zákazníka. | Vlákno čaká, kým ho niekto neoznačí „answered“. |
| `PRODUCT_NOTE.md` | Správy sa čítajú „in time order“. | Zobrazujú sa od najnovšej (zmenené o 14:44). |
| `PRODUCT_NOTE.md` | „One screen“. | Sú tam zoznam, detail vlákna a záložka „Answered“. |
| `CLOSE_NOTE.md` | Ktokoľvek môže zrušiť kolegov claim alebo zmazať „answered“. | Server to povolí iba tomu, kto vlákno zobral alebo zodpovedal. Keďže nie je prihlasovanie, stačí v hlavičke vybrať meno kolegu. Pravdivé, ale zle vysvetlené. |
| `CLOSE_NOTE.md` | „Working tree is clean.“ | Po napísaní ešte prebehli auto-commity. Drobnosť. |

### Prvý riadok vysvetlený

- **Pôvodný predpoklad:** v dátach sú správy zákazníka aj naše odpovede.
- **Prečo to nejde:** v tabuľke `requests` sú **iba správy od zákazníkov** → všetkých 22 vlákien by čakalo navždy.
- **Ako to robí aplikácia:** kolega odpovie mimo aplikácie, potom klikne „answered“ (teraz po témach).
- **Rozpor:** pravidlo som počas práce zmenil, kód je správne, veta v `PRODUCT_NOTE.md` zostala pôvodná.

### Ako to povedať

„Najprv som predpokladal, že v dátach sú aj naše odpovede. Keď som videl, že sú tam iba prichádzajúce správy, zmenil som pravidlo na ručné ‚answered‘. Poznámky som pri zmenách rozhodnutí neprepísal – to bola chyba. Poučenie: na konci porovnať poznámky s kódom. V branchi pre kolo 2 som zmeny zapísal hneď do `DECISIONS.md` a `API.md`.“

---

## 6. Čo by som spravil inak (otázka určite príde)

- ~~Čakanie merať od najstaršej nezodpovedanej správy~~ → **hotové v branchi** (bod 2).
- ~~Témy vnútri zákazníka a „answered“ po témach~~ → **hotové v branchi** (bod 1).
- ~~Aspoň jedno skutočné preklikanie v prehliadači~~ → **urobené** a hneď našlo chybu (skrytá presunutá správa).
- Na konci porovnať poznámky s kódom (bod 3).
- Skôr overiť pravidlo „čaká na nás“ priamo na dátach, pred napísaním product note.
- Prihlasovanie (aspoň jednoduché), aby meno bolo dôkaz – dnes si ktokoľvek vyberie hocijaké meno.
- História zmien (kto zobral, kto odpovedal, kto presunul, kedy) namiesto prepisovaných riadkov.

## 7. Systémový návrh – témy, ktoré nadväzujú na projekt

- **Príjem správ** z e-mailu, chatu a telefónu: fronta správ (message broker), idempotencia, odstránenie duplicít.
- **Spájanie identity zákazníka** naprieč kanálmi – návrh + potvrdenie človekom.
- **Témy pri väčšom objeme:** to isté ako teraz – reťaz podľa odkazu, ručné priradenie, „answered“ po témach. Odkaz na tému by mohol prísť už z e-mailových hlavičiek (`In-Reply-To`, `References`).
- **Prihlasovanie a role** (tím, vedúci), oprávnenia na úrovni dát.
- **Súbežnosť** – claim je jeden atomický SQL príkaz (409 pri konflikte); zmeny tém idú v transakcii so zamknutým riadkom claimu a s kontrolou `seenMessageId` (optimistické zamykanie).
- **História zmien / audit** – udalosti namiesto prepisovania.
- **Notifikácie** pri urgenciách a pri prekročení SLA (počet nezodpovedaných správ a `waitingSince` sú na to pripravené).
- **Škálovanie** na viac tímov alebo zákazníkov (tenanti), vyhľadávanie a výpočet tém na serveri / v databáze namiesto v pamäti.
- **Citlivé dáta** (identita / biometria): ukladať iba potrebné (nové tabuľky držia iba id, žiadny text), nič osobné v logoch, text správ ako text, nie HTML.

---

## 8. Ako ukázať zmeny (demo, cca 3 minúty)

1. **Zoznam:** stĺpce „Open topics“ (napr. „8 of 8“) a „Waiting“ s odznakom „14 unanswered“. Radené od najstaršej nezodpovedanej správy.
2. Na zákazníkovi klikni **„Claim and open“** (meno vpravo hore, napr. Alex Moore).
3. **Detail:** správy sú rozdelené do tém, každá má stav „Open“ / „Answered by …“.
4. Klikni **„Mark topic answered“** pri jednej téme → toast „the other open topics still wait“. Ostatné témy ostávajú otvorené.
5. Späť na zoznam: „7 of 8“, menej nezodpovedaných, čakanie sa môže skrátiť.
6. Pri správe bez odkazu: **„Move to topic…“** → vyber tému → poznámka „Moved into this topic by a colleague“. Ak bola téma zodpovedaná, znova sa otvorí (príbeh o nájdenej chybe).
7. Prípadne **„Undo“** pri téme a **„Mark all answered“** → zákazník zmizne zo zoznamu.

**Pozor:** v ukážkových dátach ešte nikto nič nezodpovedal, takže každý zákazník čaká „16–31 dní“ a má všetky témy otvorené. Je to správne – pri deme sa čísla po kliknutiach zmenšujú.

## 9. Ako si aplikáciu spustiť lokálne

Pôvodný stroj s databázou už neexistuje. Lokálne beží s **vymyslenými dátami** (22 zákazníkov, 340 správ – rovnaké počty ako skutočné dáta; momentálne je v lokálnej DB 341, jedna doplnená odpoveď).

1. Prepni sa na branch: `git switch improvements_for_round_2` (pre pôvodné riešenie `main`).
2. V IDEA spusti **Server** – sám naštartuje databázu (Docker kontajner `waiting-on-us-db`, port 5433), zbuildí a spustí aplikáciu. Nové tabuľky `topic_answers` a `message_topics` sa vytvoria samé pri štarte.
3. Otvor http://localhost:3000.
4. Testy: konfigurácia **Tests** – v branchi **153 testov**. Jeden padá iba kvôli lokálnym dátam (čaká 340 správ, v DB je 341); padal aj pred zmenami.

Potrebný je Node 26 (`/opt/homebrew/opt/node@26`). Predvolený Node 16 nefunguje.

**Ak by aplikácia bežala z priečinka, ktorého cesta obsahuje priečinok začínajúci bodkou** (napr. `~/.super.engineering/…`), v `main` vracia každý odkaz na stránku 404. V branchi je to opravené (`sendFile` s `root` v `server/app.ts`). Z `~/devel/innovatrics/waiting-on-us` funguje oboje.

## 10. Kde je čo v kóde (branch `improvements_for_round_2`)

| Súbor | Čo robí |
|---|---|
| `lib/topics.ts` | pravidlo tém: reťaze, „answered“ po témach, `waitingSince`, počet nezodpovedaných |
| `lib/waiting.ts` | radenie zoznamu od najstaršej nezodpovedanej správy |
| `lib/thread.ts` | časová os – ručne presunutá správa stojí v bloku svojej témy |
| `server/routes/topics.ts` | API: answered / reopen pre tému, presun správy |
| `server/routes/claims.ts` | „Mark all answered“ zapíše aj témy, „Undo“ ich vráti |
| `server/schema.sql` | nové tabuľky `topic_answers`, `message_topics` |
| `web/src/components/TopicList.tsx` | detail vlákna rozdelený na témy |
| `web/src/pages/InboxPage.tsx` | stĺpec „Open topics“, odznak „unanswered“ |
| `DECISIONS.md`, `API.md` | zapísané rozhodnutia (riadky „R2“) a nové endpointy |
